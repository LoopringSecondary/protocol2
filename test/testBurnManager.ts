import { expectThrow } from "protocol2-js";
import { Artifacts } from "../util/Artifacts";
import { FeePayments } from "./feePayments";

const {
  BurnManager,
  FeeHolder,
  TradeDelegate,
  DummyExchange,
  DummyToken,
  LRCToken,
  WETHToken,
} = new Artifacts(artifacts);

const DutchExchange = artifacts.require("DutchExchange");
const DutchExchangeProxy = artifacts.require("DutchExchangeProxy");
const EtherToken = artifacts.require("EtherToken");

contract("BurnManager", (accounts: string[]) => {
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];

  let tradeDelegate: any;
  let feeHolder: any;
  let dummyExchange: any;
  let burnManager: any;
  let dutchExchange: any;
  let etherToken: any;
  let tokenLRC: string;
  let tokenWETH: string;

  const advanceBlockTimestamp = async (seconds: number) => {
    const previousTimestamp = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [seconds], id: 0 });
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 0 });
    const currentTimestamp = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
    assert(Math.abs(currentTimestamp - (previousTimestamp + seconds)) < 60,
           "Timestamp should have been increased by roughly the expected value");
  };

  const getEventsFromContract = async (contract: any, eventName: string, fromBlock: number) => {
    return new Promise((resolve, reject) => {
      if (!contract[eventName]) {
        throw Error("TypeError: contract[eventName] is not a function: " + eventName);
      }

      const events = contract[eventName]({}, { fromBlock, toBlock: "latest" });
      events.watch();
      events.get((error: any, event: any) => {
        if (!error) {
          resolve(event);
        } else {
          throw Error("Failed to find filtered event: " + error);
        }
      });
      events.stopWatching();
    });
  };

  const authorizeAddressChecked = async (address: string, transactionOrigin: string) => {
    await tradeDelegate.authorizeAddress(address, {from: transactionOrigin});
    await assertAuthorized(address);
  };

  const assertAuthorized = async (address: string) => {
    const isAuthorizedInDelegate = await tradeDelegate.isAddressAuthorized(address);
    assert.equal(isAuthorizedInDelegate, true, "exchange not authorized.");
  };

  const burnChecked = async (token: string, expectedAmount: number) => {
    const dummyToken = DummyToken.at(token);
    const LRC = DummyToken.at(tokenLRC);

    const balanceFeeHolderBefore = (await dummyToken.balanceOf(feeHolder.address)).toNumber();
    const burnBalanceBefore = (await feeHolder.feeBalances(token, feeHolder.address)).toNumber();
    const totalLRCSupplyBefore = await LRC.totalSupply();

    // Burn
    const success = await burnManager.burn(token, {from: user1});
    assert(success, "Burn needs to succeed");

    const balanceFeeHolderAfter = (await dummyToken.balanceOf(feeHolder.address)).toNumber();
    const burnBalanceAfter = (await feeHolder.feeBalances(token, feeHolder.address)).toNumber();
    const totalLRCSupplyAfter = await LRC.totalSupply();
    assert.equal(balanceFeeHolderAfter, balanceFeeHolderBefore - expectedAmount, "Contract balance should be reduced.");
    assert.equal(burnBalanceAfter, burnBalanceBefore - expectedAmount, "Withdrawal amount not correctly updated.");
    if (token === tokenLRC) {
      assert.equal(totalLRCSupplyAfter, totalLRCSupplyBefore - expectedAmount,
                   "Total LRC supply should have been decreased by all LRC burned");
    }
  };

  const addToken = async (token: string) => {
    // We can add a token to DutchX by selling 10.000$ WETH or more for the token we want to add
    const amount = 100e18;
    await etherToken.deposit({value: amount, from: user1});
    await etherToken.approve(dutchExchange.address, amount, {from: user1});
    await dutchExchange.deposit(etherToken.address, amount, {from: user1});
    await dutchExchange.addTokenPair(etherToken.address, tokenLRC, amount, 0, 10, 1, {from: user1});
  };

  before(async () => {
    tokenLRC = LRCToken.address;
    tokenWETH = WETHToken.address;
    etherToken = await EtherToken.deployed();

    tradeDelegate = await TradeDelegate.deployed();
    const dutchExchangeProxy = await DutchExchangeProxy.deployed();
    dutchExchange = DutchExchange.at(dutchExchangeProxy.address);
  });

  beforeEach(async () => {
    // Fresh FeeHolder for each test
    feeHolder = await FeeHolder.new(tradeDelegate.address);
    burnManager = await BurnManager.new(feeHolder.address, tokenLRC, dutchExchange.address);
    dummyExchange = await DummyExchange.new(tradeDelegate.address, "0x0", feeHolder.address, "0x0");
    await authorizeAddressChecked(dummyExchange.address, deployer);
    await authorizeAddressChecked(burnManager.address, deployer);
  });

  describe("any user", () => {
    it("should be able to burn LRC deposited as burned in the FeeHolder contract", async () => {
      const amount = 1e18;

      // Deposit some LRC in the fee holder contract
      const LRC = DummyToken.at(tokenLRC);
      await LRC.transfer(feeHolder.address, amount, {from: deployer});
      const feePayments = new FeePayments();
      feePayments.add(feeHolder.address, tokenLRC, amount);
      await dummyExchange.batchAddFeeBalances(feePayments.getData());

      // Burn all LRC
      await burnChecked(tokenLRC, amount);
    });

    it("should be able to burn non-LRC tokens using DutchX", async () => {
      // First make sure we can trade LRC on DutchX by adding the token pair WETH/LRC
      await addToken(tokenLRC);

      const amount = 100e18;

      // Deposit some LRC in the fee holder contract
      await etherToken.deposit({value: amount, from: user1});
      await etherToken.transfer(feeHolder.address, amount, {from: user1});
      const feePayments = new FeePayments();
      feePayments.add(feeHolder.address, etherToken.address, amount);
      await dummyExchange.batchAddFeeBalances(feePayments.getData());

      // Burn WETH
      await burnManager.burn(etherToken.address);
      // Listen to the BurnAuction event to get the auction index
      const eventArr: any = await getEventsFromContract(burnManager, "BurnAuction", web3.eth.blockNumber);
      const burnAuctionIndices = eventArr.map((eventObj: any) => {
        return eventObj.args.auctionIndex;
      });
      assert.equal(burnAuctionIndices.length, 1, "Only a single BurnAuction event can be emitted");
      const auctionIndex = burnAuctionIndices[0];

      // Wait 6 hours until the the price is at the expected price
      await advanceBlockTimestamp(6 * 60 * 60 + 1000);

      // Buy WETH using LRC in the auction
      const LRC = DummyToken.at(tokenLRC);
      // Deposit some LRC in the fee holder contract
      await LRC.transfer(user2, amount * 100, {from: deployer});
      // Deposit funds to DutchX
      await LRC.approve(dutchExchange.address, amount * 100, {from: user2});
      await dutchExchange.deposit(tokenLRC, amount * 100, {from: user2});
      // But WETH using LRC and end to auction
      await dutchExchange.postBuyOrder(etherToken.address, LRC.address, auctionIndex, amount * 100, {from: user2});

      // Burn the LRC bought in the auction
      await burnManager.burnAuctioned([ etherToken.address ], [ auctionIndex ]);
    });
  });
});
