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
  GTOToken,
} = new Artifacts(artifacts);

const DutchExchange = artifacts.require("DutchExchange");
const DutchExchangeProxy = artifacts.require("DutchExchangeProxy");
const EtherToken = artifacts.require("EtherToken");

contract("BurnManager", (accounts: string[]) => {
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];

  const waitingPeriodNewTokenPair = 6 * 3600;
  const waitingPeriodEqualPrice = 6 * 3600;

  let tradeDelegate: any;
  let feeHolder: any;
  let dummyExchange: any;
  let burnManager: any;
  let dutchExchange: any;
  let etherToken: any;
  let LRC: any;
  let GTO: any;
  let tokenLRC: string;
  let tokenWETH: string;
  let tokenGTO: string;

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

  const buy = async (auctionIndex: number, sellToken: string, buyToken: string, amount: number, user: string) => {
    // Buy using token in the auction
    const Token = DummyToken.at(buyToken);
    // Deposit some LRC in the fee holder contract
    await Token.transfer(user, amount, {from: deployer});
    // Deposit funds to DutchX
    await Token.approve(dutchExchange.address, amount, {from: user});
    await dutchExchange.deposit(buyToken, amount, {from: user});
    // Buy WETH using LRC and end the auction
    await dutchExchange.postBuyOrder(sellToken, buyToken, auctionIndex, amount, {from: user});
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

    const balanceFeeHolderBefore = (await dummyToken.balanceOf(feeHolder.address)).toNumber();
    const burnBalanceBefore = (await feeHolder.feeBalances(token, feeHolder.address)).toNumber();
    const totalLRCSupplyBefore = await LRC.totalSupply();

    // Burn
    const success = await burnManager.burn([token], {from: user1});
    assert(success, "Burn needs to succeed");

    const balanceFeeHolderAfter = (await dummyToken.balanceOf(feeHolder.address)).toNumber();
    const burnBalanceAfter = (await feeHolder.feeBalances(token, feeHolder.address)).toNumber();
    const totalLRCSupplyAfter = await LRC.totalSupply();
    assert.equal(balanceFeeHolderAfter, balanceFeeHolderBefore - expectedAmount, "Contract balance should be reduced.");
    assert.equal(burnBalanceAfter, burnBalanceBefore - expectedAmount, "Withdrawal amount not correctly updated.");
    if (token === tokenLRC) {
      assert.equal(totalLRCSupplyAfter, totalLRCSupplyBefore - expectedAmount,
                   "Total LRC supply should have been decreased by all LRC burned");
    } else {
       // Listen to the BurnAuction event to get the auction index
       const eventBurnAuctionArr: any = await getEventsFromContract(burnManager, "BurnAuction", web3.eth.blockNumber);
       const burnAuctionIndices = eventBurnAuctionArr.map((eventObj: any) => {
         return eventObj.args.auctionIndex;
       });
       assert.equal(burnAuctionIndices.length, 1, "Only a single BurnAuction event can be emitted per token");
       const auctionIndex = burnAuctionIndices[0];
       return auctionIndex;
    }
  };

  const burnAuctionedChecked = async (tokens: string[], auctionIndices: number[], expectedAmount: number) => {
    await burnManager.burnAuctioned(tokens, auctionIndices);
    // Listen to the Burn event on the LRC contract to know how much was burned
    const eventBurnArr: any = await getEventsFromContract(LRC, "Burn", web3.eth.blockNumber);
    const burnValues = eventBurnArr.map((eventObj: any) => {
      return eventObj.args.value;
    });
    assert.equal(burnValues.length, 1, "Only a single Burn event can be emitted");
    // Amount LRC bought should match the amount we expect within 2% accuracy
    // (Fee and time can differ a bit)
    assert(Math.abs(burnValues[0] - (expectedAmount)) < 2 * expectedAmount / 100,
           "Burned amount should match the amount LRC bought");
  };

  const addTokenPair = async (sellToken: string, buyToken: string, price: number) => {
    // We can add a token to DutchX by selling 10.000$ WETH or more for the token we want to add
    const amount = 100e18;
    if (sellToken === etherToken.address) {
      await etherToken.deposit({value: amount, from: user1});
    } else {
      const Token = DummyToken.at(sellToken);
      await Token.transfer(user1, amount, {from: deployer});
    }

    const SellToken = (sellToken === etherToken.address) ? etherToken : DummyToken.at(sellToken);
    await SellToken.approve(dutchExchange.address, amount, {from: user1});
    await dutchExchange.deposit(sellToken, amount, {from: user1});
    await dutchExchange.addTokenPair(sellToken, buyToken, amount, 0, price, 1, {from: user1});

    // Listen to the BurnAuction event to get the auction index
    const eventBurnAuctionArr: any =
      await getEventsFromContract(dutchExchange, "AuctionStartScheduled", web3.eth.blockNumber);
    const burnAuctionIndices = eventBurnAuctionArr.map((eventObj: any) => {
      return eventObj.args.auctionIndex;
    });
    assert.equal(burnAuctionIndices.length, 1, "Only a single BurnAuction event can be emitted per token");
    const auctionIndex = burnAuctionIndices[0];

    // Wait 6 hours until the the price is at the expected price
    await advanceBlockTimestamp(waitingPeriodNewTokenPair + waitingPeriodEqualPrice);

    // Buy WETH using LRC in the auction
    await buy(auctionIndex, sellToken, buyToken, amount * price * 2, user2);
  };

  before(async () => {
    tokenLRC = LRCToken.address;
    tokenWETH = WETHToken.address;
    tokenGTO = GTOToken.address;
    etherToken = await EtherToken.deployed();
    LRC = DummyToken.at(tokenLRC);
    GTO = DummyToken.at(tokenGTO);

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
      await LRC.transfer(feeHolder.address, amount, {from: deployer});
      const feePayments = new FeePayments();
      feePayments.add(feeHolder.address, tokenLRC, amount);
      await dummyExchange.batchAddFeeBalances(feePayments.getData());

      // Burn all LRC
      await burnChecked(tokenLRC, amount);
    });

    describe("DutchX", () => {
      it("should be able to sell WETH for LRC using DutchX and burn the LRC amount bought", async () => {
        // First make sure we can trade LRC on DutchX by adding the token pair WETH/LRC
        await addTokenPair(etherToken.address, tokenLRC, 10);

        const amount = 10e18;

        // Deposit some WETH in the fee holder contract
        await etherToken.deposit({value: amount, from: user1});
        await etherToken.transfer(feeHolder.address, amount, {from: user1});
        const feePayments = new FeePayments();
        feePayments.add(feeHolder.address, etherToken.address, amount);
        await dummyExchange.batchAddFeeBalances(feePayments.getData());

        // Burn WETH
        const auctionIndex = await burnChecked(etherToken.address, amount);

        // Wait 6 hours until the the price is at the expected price
        await advanceBlockTimestamp(waitingPeriodEqualPrice);

        // Buy WETH using LRC in the auction
        await buy(auctionIndex, etherToken.address, tokenLRC, amount * 100, user2);

        // Burn the LRC bought in the auction
        await burnAuctionedChecked([etherToken.address], [auctionIndex], amount * 10);

        // Transaction shouldn't revert when the tokens in the auction were already burned
        await burnManager.burnAuctioned([etherToken.address], [auctionIndex]);
      });

      it("should be able to sell non-WETH for LRC using DutchX and burn the LRC amount bought", async () => {
        // Make sure we can trade GTO on DutchX by adding the token pair WETH/GTO
        await addTokenPair(etherToken.address, tokenGTO, 10);
        // Now add the GTO/LRC pair
        await addTokenPair(tokenGTO, tokenLRC, 1);

        const amount = 10e18;

        // Deposit some GTO in the fee holder contract
        await GTO.transfer(feeHolder.address, amount, {from: deployer});
        const feePayments = new FeePayments();
        feePayments.add(feeHolder.address, GTO.address, amount);
        await dummyExchange.batchAddFeeBalances(feePayments.getData());

        // Burn GTO
        const auctionIndex = await burnChecked(GTO.address, amount);

        // Wait 6 hours until the the price is at the expected price
        await advanceBlockTimestamp(waitingPeriodEqualPrice);

        // Buy GTO using LRC in the auction
        await buy(auctionIndex, tokenGTO, tokenLRC, amount * 100, user2);

        // Burn the LRC bought in the auction
        await burnAuctionedChecked([GTO.address], [auctionIndex], amount);
      });
    });
  });
});
