import { BigNumber } from "bignumber.js";
import BN = require("bn.js");
import abi = require("ethereumjs-abi");
import { BalanceBook, Bitstream, expectThrow, TokenType } from "protocol2-js";
import { Artifacts } from "../util/Artifacts";

const {
  TradeDelegate,
  DummyToken,
  DummyExchange,
  LRCToken,
  GTOToken,
  RDNToken,
  WETHToken,
  TESTToken,
  DummyERC1400Token,
  STAToken,
  STBToken,
  SECTESTToken,
} = new Artifacts(artifacts);

interface TokenTransfer {
  token: string;
  from: string;
  to: string;
  amount: number;
  tokenType: TokenType;
  tranche: string;
  transferData: string;
}

interface FilledUpdate {
  hash: string;
  amount: number;
}

interface Order {
  broker: string;
  owner: string;
  tradingPair: number;
  validSince: number;
  hash: number;
}

contract("TradeDelegate", (accounts: string[]) => {
  const owner = accounts[0];
  const broker1 = accounts[1];
  const broker2 = accounts[2];
  const broker3 = accounts[3];
  const broker4 = accounts[4];
  const user1 = accounts[5];
  const user2 = accounts[6];
  const user3 = accounts[7];
  const user4 = accounts[8];
  const emptyAddr = "0x" + "0".repeat(40);
  const zeroTranche = "0x" + "0".repeat(64);
  const tranche1 = "0x" + "01".repeat(32);
  const tranche2 = "0x" + "23".repeat(32);

  let tradeDelegate: any;
  let dummyExchange1: any;
  let dummyExchange2: any;
  let dummyExchange3: any;
  let erc20Token1: string;
  let erc20Token2: string;
  let erc20Token3: string;
  let erc20Token4: string;
  let erc1400Token1: string;
  let erc1400Token2: string;

  let TestToken: any;
  let testToken: string;
  let SecTestToken: any;
  let secTestToken: string;

  const numberToBytesX = (value: number, numBytes: number) => {
    const bitstream = new Bitstream();
    bitstream.addNumber(value, numBytes);
    return bitstream.getData();
  };

  const addERC20TokenTransfer = (transfers: TokenTransfer[],
                                 token: string,
                                 from: string,
                                 to: string,
                                 amount: number) => {
    const transfer: TokenTransfer = {
      token,
      from,
      to,
      amount,
      tokenType: TokenType.ERC20,
      tranche: zeroTranche,
      transferData: "0x",
    };
    transfers.push(transfer);
  };

  const addERC1400TokenTransfer = (transfers: TokenTransfer[],
                                   token: string,
                                   from: string,
                                   to: string,
                                   amount: number,
                                   tranche: string,
                                   transferData: string) => {
    const transfer: TokenTransfer = {
      token,
      from,
      to,
      amount,
      tokenType: TokenType.ERC1400,
      tranche,
      transferData,
    };
    transfers.push(transfer);
  };

  const addFilledUpdate = (updates: FilledUpdate[], hash: number,  amount: number) => {
    const update: FilledUpdate = {
      hash: numberToBytesX(hash, 32),
      amount,
    };
    updates.push(update);
  };

  const addOrder = (orders: Order[],
                    broker: string,
                    orderOwner: string,
                    tradingPair: number,
                    validSince: number,
                    hash: number) => {
    const order: Order = {
      broker,
      owner: orderOwner,
      tradingPair,
      validSince,
      hash,
    };
    orders.push(order);
  };

  const toTransferBatch = (transfers: TokenTransfer[]) => {
    const bitstream = new Bitstream();
    for (const transfer of transfers) {
      bitstream.addAddress(transfer.token, 32);
      bitstream.addAddress(transfer.from, 32);
      bitstream.addAddress(transfer.to, 32);
      bitstream.addNumber(transfer.amount, 32);
      bitstream.addNumber(transfer.tokenType === TokenType.ERC20 ? 0 : 1, 32);
      bitstream.addHex(transfer.tranche);
      assert(transfer.transferData.length % 2 === 0, "Transfer data needs to be aligned to a byte");
      bitstream.addNumber(transfer.transferData.length / 2 - 1, 32);
      bitstream.addHex(transfer.transferData);
    }
    return bitstream.getData();
  };

  const toFilledBatch = (updates: FilledUpdate[]) => {
    const bitstream = new Bitstream();
    for (const update of updates) {
      bitstream.addHex(update.hash);
      bitstream.addNumber(update.amount, 32);
    }
    return bitstream.getBytes32Array();
  };

  const toCutoffBatch = (orders: Order[]) => {
    const bitstream = new Bitstream();
    for (const order of orders) {
      bitstream.addAddress(order.broker, 32);
      bitstream.addAddress(order.owner, 32);
      bitstream.addNumber(order.hash, 32);
      bitstream.addNumber(order.validSince, 32);
      // Padding is done on the RIGHT for bytes20 for some reason.
      // But addresses are padded on the left (even though they are both 20 bytes)...
      bitstream.addNumber(order.tradingPair, 20);
      bitstream.addNumber(0, 12);
    }
    return bitstream.getBytes32Array();
  };

  const setERC20UserBalance = async (token: string, user: string, balance: number, approved?: number) => {
    const dummyToken = await DummyToken.at(token);
    await dummyToken.setBalance(user, balance);
    const approvedAmount = approved ? approved : balance;
    await dummyToken.approve(tradeDelegate.address, approvedAmount, {from: user});
  };

  const setERC1400UserBalance = async (token: string,
                                       tranche: string,
                                       user: string,
                                       balance: number) => {
    const dummyToken = await DummyERC1400Token.at(token);
    await dummyToken.setBalance(user, tranche, balance);
    await dummyToken.authorizeOperator(tradeDelegate.address, {from: user});
  };

  const authorizeAddressChecked = async (address: string, transactionOrigin: string) => {
    await tradeDelegate.authorizeAddress(address, {from: transactionOrigin});
    await assertAuthorized(address);
  };

  const deauthorizeAddressChecked = async (address: string, transactionOrigin: string) => {
    await tradeDelegate.deauthorizeAddress(address, {from: transactionOrigin});
    await assertDeauthorized(address);
  };

  const assertAuthorized = async (address: string) => {
    const isAuthorizedInDelegate = await tradeDelegate.isAddressAuthorized(address);
    assert.equal(isAuthorizedInDelegate, true, "should be able to authorize an address");
  };

  const assertDeauthorized = async (address: string) => {
    const isAuthorizedInDelegate = await tradeDelegate.isAddressAuthorized(address);
    assert.equal(isAuthorizedInDelegate, false, "should be able to deauthorize an address");
  };

  const assertOrdersValid = (result: BigNumber[], expectedValues: boolean[]) => {
    const cancelledValue = new BigNumber("F".repeat(64), 16);
    for (const [i, order] of expectedValues.entries()) {
        assert.equal(!result[i].eq(cancelledValue), expectedValues[i],
                     "Order cancelled status incorrect for order " + i);
    }
  };

  const batchTransferChecked = async (transfers: TokenTransfer[]) => {
    // Calculate expected balances
    const balances = new BalanceBook();
    for (const transfer of transfers) {
      if (transfer.tokenType === TokenType.ERC20) {
        const dummyToken = await DummyToken.at(transfer.token);
        const balanceFrom = await dummyToken.balanceOf(transfer.from);
        const balanceTo = await dummyToken.balanceOf(transfer.to);
        balances.setBalance(transfer.from, transfer.token, transfer.tranche, balanceFrom);
        balances.setBalance(transfer.to, transfer.token, transfer.tranche, balanceTo);
      } else if (transfer.tokenType === TokenType.ERC1400) {
        const dummyToken = await DummyERC1400Token.at(transfer.token);
        const balanceFrom = await dummyToken.balanceOfTranche(transfer.tranche, transfer.from);
        const balanceTo = await dummyToken.balanceOfTranche(transfer.tranche, transfer.to);
        balances.setBalance(transfer.from, transfer.token, transfer.tranche, balanceFrom);
        balances.setBalance(transfer.to, transfer.token, transfer.tranche, balanceTo);
      }
    }
    // Emulate transfers
    for (const transfer of transfers) {
      balances.addBalance(transfer.from, transfer.token, transfer.tranche, new BigNumber(-transfer.amount, 10));
      balances.addBalance(transfer.to, transfer.token, transfer.tranche, new BigNumber(transfer.amount, 10));
    }
    // Update fee balances
    const batch = toTransferBatch(transfers);
    await dummyExchange1.batchTransfer(batch);
    // Check if we get the expected results
    for (const transfer of transfers) {
      let balanceFrom: BigNumber;
      let balanceTo: BigNumber;
      if (transfer.tokenType === TokenType.ERC20) {
        const dummyToken = await DummyToken.at(transfer.token);
        balanceFrom = await dummyToken.balanceOf(transfer.from);
        balanceTo = await dummyToken.balanceOf(transfer.to);
      } else if (transfer.tokenType === TokenType.ERC1400) {
        const dummyToken = await DummyERC1400Token.at(transfer.token);
        balanceFrom = await dummyToken.balanceOfTranche(transfer.tranche, transfer.from);
        balanceTo = await dummyToken.balanceOfTranche(transfer.tranche, transfer.to);
      }
      const expectedBalanceFrom = balances.getBalance(transfer.from, transfer.token, transfer.tranche);
      const expectedBalanceTo = balances.getBalance(transfer.to, transfer.token, transfer.tranche);
      assert(balanceFrom.eq(expectedBalanceFrom), "Token balance does not match expected value");
      assert(balanceTo.eq(expectedBalanceTo), "Token balance does not match expected value");
    }
  };

  const batchUpdateFilledChecked = async (updates: FilledUpdate[]) => {
    // Calculate expected filled
    const fills: { [id: string]: number; } = {};
    for (const update of updates) {
      fills[update.hash] = update.amount;
    }
    // Update filled amounts
    const batch = toFilledBatch(updates);
    await dummyExchange1.batchUpdateFilled(batch);
    // Check if we get the expected results
    for (const update of updates) {
      const filled = (await tradeDelegate.filled(update.hash)).toNumber();
      const expectedFilled = fills[update.hash];
      assert.equal(filled, expectedFilled, "Filled amount does not match expected value");
    }
  };

  before(async () => {
    erc20Token1 = LRCToken.address;
    erc20Token2 = WETHToken.address;
    erc20Token3 = RDNToken.address;
    erc20Token4 = GTOToken.address;
    erc1400Token1 = STAToken.address;
    erc1400Token2 = STBToken.address;
  });

  beforeEach(async () => {
    tradeDelegate = await TradeDelegate.new(20);
    dummyExchange1 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0");
    dummyExchange2 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0");
    dummyExchange3 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0");
    TestToken = await TESTToken.new();
    testToken = TestToken.address;
    SecTestToken = await SECTESTToken.new();
    secTestToken = SecTestToken.address;
  });

  describe("contract owner", () => {
    it("should be able to authorize an address", async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
      await authorizeAddressChecked(dummyExchange2.address, owner);
      await authorizeAddressChecked(dummyExchange3.address, owner);
    });

    it("should be able to deauthorize an address", async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
      await authorizeAddressChecked(dummyExchange2.address, owner);
      await authorizeAddressChecked(dummyExchange3.address, owner);
      await deauthorizeAddressChecked(dummyExchange2.address, owner);
      await assertAuthorized(dummyExchange1.address);
      await assertAuthorized(dummyExchange3.address);
      await deauthorizeAddressChecked(dummyExchange1.address, owner);
      await assertAuthorized(dummyExchange3.address);
      await deauthorizeAddressChecked(dummyExchange3.address, owner);
    });

    it("should not be able to authorize a non-contract address", async () => {
      await expectThrow(authorizeAddressChecked(emptyAddr, owner), "ZERO_ADDRESS");
      await expectThrow(authorizeAddressChecked(user2, owner), "INVALID_ADDRESS");
    });

    it("should not be able to authorize an address twice", async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
      await expectThrow(authorizeAddressChecked(dummyExchange1.address, owner), "ALREADY_EXIST");
    });

    it("should not be able to deauthorize an unathorized address", async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
      await expectThrow(deauthorizeAddressChecked(emptyAddr, owner), "ZERO_ADDRESS");
      await expectThrow(deauthorizeAddressChecked(dummyExchange2.address, owner), "NOT_FOUND");
    });

    it("should be able to suspend and resume the contract", async () => {
      await tradeDelegate.suspend({from: owner});
      // Try to do a transfer
      await authorizeAddressChecked(dummyExchange1.address, owner);
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      await expectThrow(batchTransferChecked(transfers), "INVALID_STATE");
      // Resume again
      await tradeDelegate.resume({from: owner});
      // Try the trade again
      await batchTransferChecked(transfers);
    });

    it("should be able to kill the contract", async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
      // Suspend is needed before kill
      await expectThrow(tradeDelegate.kill({from: owner}), "INVALID_STATE");
      await tradeDelegate.suspend({from: owner});
      await tradeDelegate.kill({from: owner});
      // Try to resume again
      await expectThrow(tradeDelegate.resume({from: owner}), "NOT_OWNER");
      // Try to do a transfer
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      await expectThrow(batchTransferChecked(transfers), "INVALID_STATE");
    });
  });

  describe("authorized address", () => {
    beforeEach(async () => {
      await authorizeAddressChecked(dummyExchange1.address, owner);
    });

    it("should be able to batch transfer tokens", async () => {
      // Make sure everyone has enough funds
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      await setERC20UserBalance(erc20Token2, user1, 10e18);
      await setERC20UserBalance(erc20Token2, user2, 10e18);
      await setERC20UserBalance(erc20Token3, user3, 10e18);
      await setERC1400UserBalance(erc1400Token1, tranche1, user1, 10e18);
      await setERC1400UserBalance(erc1400Token1, tranche2, user1, 10e18);
      await setERC1400UserBalance(erc1400Token2, tranche1, user2, 10e18);
      {
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1.5e18);
        addERC20TokenTransfer(transfers, erc20Token1, user1, user3, 2.5e18);
        addERC20TokenTransfer(transfers, erc20Token2, user2, user3, 2.2e18);
        addERC20TokenTransfer(transfers, erc20Token2, user2, user1, 0.3e18);
        addERC20TokenTransfer(transfers, erc20Token2, user1, user3, 2.5e18);
        addERC1400TokenTransfer(transfers, erc1400Token1, user1, user2, 1.5e18, tranche1, "0x");
        await batchTransferChecked(transfers);
      }
      {
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, erc20Token1, user1, user3, 1.5e18);
        addERC20TokenTransfer(transfers, erc20Token3, user3, user2, 2.5e18);
        addERC1400TokenTransfer(transfers, erc1400Token1, user1, user3, 2.5e18, tranche2, "0x");
        addERC20TokenTransfer(transfers, erc20Token3, user3, user1, 1.5e18);
        await batchTransferChecked(transfers);
      }
      {
        const transfers: TokenTransfer[] = [];
        addERC1400TokenTransfer(transfers, erc1400Token2, user2, user1, 3.5e18, tranche1, "0x");
        // No tokens to be transfered
        addERC20TokenTransfer(transfers, erc20Token1, user1, user3, 0);
        // From == To
        addERC20TokenTransfer(transfers, erc20Token3, user3, user3, 2.5e18);
        await batchTransferChecked(transfers);
      }
    });

    it("should not be able to batch transfer tokens with malformed data", async () => {
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      addERC20TokenTransfer(transfers, erc20Token1, user1, user3, 2e18);
      const batch = toTransferBatch(transfers).slice(0, -1);
      await expectThrow(dummyExchange1.batchTransfer(batch), "INVALID_SIZE");
    });

    it("should not be able to batch transfer tokens with invalid token address", async () => {
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      const batch = toTransferBatch(transfers);
      await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
    });

    it("should be able to batch update filled", async () => {
      const hash1 = 123;
      const hash2 = 456;
      const hash3 = 789;
      const hash4 = 147;
      {
        const updates: FilledUpdate[] = [];
        addFilledUpdate(updates, hash1, 1.5e18);
        addFilledUpdate(updates, hash2, 1.1e18);
        addFilledUpdate(updates, hash2, 1.3e18);
        addFilledUpdate(updates, hash1, 2.3e18);
        await batchUpdateFilledChecked(updates);
      }
      {
        const updates: FilledUpdate[] = [];
        addFilledUpdate(updates, hash3, 1.5e18);
        addFilledUpdate(updates, hash3, 1.9e18);
        addFilledUpdate(updates, hash1, 3.3e18);
        addFilledUpdate(updates, hash4, 7.3e18);
        addFilledUpdate(updates, hash2, 2.3e18);
        await batchUpdateFilledChecked(updates);
      }
    });

    it("should not be able to batch update filled with malformed data", async () => {
      const hash1 = 123;
      const hash2 = 456;
      const updates: FilledUpdate[] = [];
      addFilledUpdate(updates, hash1, 1e18);
      addFilledUpdate(updates, hash2, 2e18);
      const batch = toFilledBatch(updates);
      batch.pop();
      await expectThrow(dummyExchange1.batchUpdateFilled(batch), "INVALID_SIZE");
    });

    it("should not be able to authorize an address", async () => {
      await expectThrow(dummyExchange1.authorizeAddress(dummyExchange2.address), "NOT_OWNER");
    });

    it("should not be able to deauthorize an address", async () => {
      await expectThrow(dummyExchange1.authorizeAddress(dummyExchange1.address), "NOT_OWNER");
    });

    it("should not be able to suspend and resume the contract", async () => {
      await expectThrow(dummyExchange1.suspend(), "NOT_OWNER");
      await tradeDelegate.suspend({from: owner});
      // Try to resume again
      await expectThrow(dummyExchange1.resume(), "NOT_OWNER");
      await tradeDelegate.resume({from: owner});
    });

    describe("Cancelling", () => {
      describe("owner (broker == owner)", () => {
        it("should be able to cancel all orders up to a set time", async () => {
          const orders: Order[] = [];
          addOrder(orders, user1, user1, 123, 1000, 1);
          addOrder(orders, user1, user1, 456, 2500, 2);
          addOrder(orders, user1, user1, 789, 1500, 3);
          addOrder(orders, user2, user2, 123, 1500, 4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setCutoffs(user1, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, false, true]);
          }
        });

        it("should be able to cancel all trading pair orders up to a set time", async () => {
          const tradingPairToCancel = 666;
          const orders: Order[] = [];
          addOrder(orders, user1, user1, tradingPairToCancel, 3000, 1);
          addOrder(orders, user1, user1, tradingPairToCancel, 1000, 2);
          addOrder(orders, user1, user1,                 789, 1000, 3);
          addOrder(orders, user2, user2, tradingPairToCancel, 1000, 4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setTradingPairCutoffs(user1, numberToBytesX(tradingPairToCancel, 20), 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, false, true, true]);
          }
        });

        it("should be able to cancel a single order", async () => {
          const orderHashOwner1ToCancel = 666;
          const orderHashOwner2ToCancel = 666;
          const orders: Order[] = [];
          addOrder(orders, user1, user1, 123, 3000, orderHashOwner1ToCancel);
          addOrder(orders, user1, user1, 456, 1000,                       2);
          addOrder(orders, user2, user2, 789, 1000, orderHashOwner1ToCancel);
          addOrder(orders, user2, user2, 123, 1000,                       4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setCancelled(user2, numberToBytesX(orderHashOwner2ToCancel, 32));
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, false, true]);
          }
          await dummyExchange1.setCancelled(user1, numberToBytesX(orderHashOwner1ToCancel, 32));
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, false, true]);
          }
        });

        it("should not be able to uncancel orders by setting the cutoff earlier", async () => {
          await dummyExchange1.setCutoffs(user1, 10000);
          await dummyExchange1.setCutoffs(user1, 20000);
          await expectThrow(dummyExchange1.setCutoffs(user1, 19000), "INVALID_VALUE");
        });

        it("should not be able to uncancel orders by setting the trading pair cutoff earlier", async () => {
          const tradingPair = numberToBytesX(123, 20);
          dummyExchange1.setTradingPairCutoffs(user1, tradingPair, 2000);
          dummyExchange1.setTradingPairCutoffs(user1, tradingPair, 4000);
          await expectThrow(dummyExchange1.setTradingPairCutoffs(user1, tradingPair, 3000), "INVALID_VALUE");
        });
      });
      describe("broker (broker != owner)", () => {
        it("should be able to cancel all orders of a single owner", async () => {
          const orders: Order[] = [];
          addOrder(orders, broker1, user1, 123, 1000, 1);
          addOrder(orders, broker1, user2, 456, 1000, 2);
          addOrder(orders, broker1, user1, 789, 1000, 3);
          addOrder(orders, broker2, user1, 123, 1000, 4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setCutoffsOfOwner(broker1, user1, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, false, true]);
          }
        });

        it("should be able to cancel all orders of all owners for which he is the broker", async () => {
          const orders: Order[] = [];
          addOrder(orders, broker1,   user1, 123, 1000, 1);
          addOrder(orders, broker1,   user2, 456, 1000, 2);
          addOrder(orders, broker1, broker1, 789, 1000, 3);
          addOrder(orders, broker2,   user1, 123, 1000, 4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setCutoffs(broker1, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, false, false, true]);
          }
        });

        it("should be able to cancel all trading pair orders of a single owner up to a set time", async () => {
          const tradingPairToCancel = 666;
          const orders: Order[] = [];
          addOrder(orders, broker1, user1, tradingPairToCancel, 3000, 1);
          addOrder(orders, broker1, user1, tradingPairToCancel, 1000, 2);
          addOrder(orders, broker1, user1,                   1, 1000, 3);
          addOrder(orders, broker1, user2, tradingPairToCancel, 1000, 4);
          addOrder(orders, broker2, user1, tradingPairToCancel, 1000, 5);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true, true]);
          }
          const tradingPairEncoded = numberToBytesX(tradingPairToCancel, 20);
          await dummyExchange1.setTradingPairCutoffsOfOwner(broker1, user1, tradingPairEncoded, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, false, true, true, true]);
          }
        });

        it("should be able to cancel a single order of an owner", async () => {
          const orderHashOwner1ToCancel = 666;
          const orderHashOwner2ToCancel = 666;
          const orders: Order[] = [];
          addOrder(orders, broker1, user1, 123, 1000, orderHashOwner1ToCancel);
          addOrder(orders, broker1, user2, 456, 1000,                       2);
          addOrder(orders, broker2, user1, 789, 1000, orderHashOwner2ToCancel);
          addOrder(orders, broker2, user1, 123, 1000,                       4);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true, true]);
          }
          await dummyExchange1.setCancelled(broker2, numberToBytesX(orderHashOwner2ToCancel, 32));
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, false, true]);
          }
          await dummyExchange1.setCancelled(broker1, numberToBytesX(orderHashOwner1ToCancel, 32));
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, false, true]);
          }
        });

        it("should not be able to uncancel orders by setting the cutoff earlier", async () => {
          await dummyExchange1.setCutoffsOfOwner(broker1, user1, 10000);
          await dummyExchange1.setCutoffsOfOwner(broker1, user1, 20000);
          await expectThrow(dummyExchange1.setCutoffsOfOwner(broker1, user1, 19000), "INVALID_VALUE");
          await dummyExchange1.setCutoffsOfOwner(broker2, user1, 19000);
          await dummyExchange1.setCutoffsOfOwner(broker1, user2, 19000);
        });

        it("should not be able to uncancel orders by setting the trading pair cutoff earlier", async () => {
          const tradingPair = numberToBytesX(123, 20);
          dummyExchange1.setTradingPairCutoffsOfOwner(broker1, user1, tradingPair, 2000);
          dummyExchange1.setTradingPairCutoffsOfOwner(broker1, user1, tradingPair, 4000);
          await expectThrow(dummyExchange1.setTradingPairCutoffsOfOwner(broker1, user1, tradingPair, 3000),
                            "INVALID_VALUE");
          await dummyExchange1.setTradingPairCutoffsOfOwner(broker1, user2, tradingPair, 3000);
          await dummyExchange1.setTradingPairCutoffsOfOwner(broker2, user1, tradingPair, 3000);
        });

        it("owner should not be able to cancel all orders created by its broker", async () => {
          const orders: Order[] = [];
          addOrder(orders,   user1, user1, 123, 1000, 1);
          addOrder(orders, broker1, user1, 456, 1000, 2);
          addOrder(orders, broker2, user1, 789, 1000, 3);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true]);
          }
          await dummyExchange1.setCutoffs(user1, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, true]);
          }
        });

        it("owner should not be able to cancel all trading pair orders created by its broker", async () => {
          const tradingPairToCancel = 666;
          const orders: Order[] = [];
          addOrder(orders,   user1, user1, tradingPairToCancel, 1000, 1);
          addOrder(orders, broker1, user1, tradingPairToCancel, 1000, 2);
          addOrder(orders, broker2, user1, tradingPairToCancel, 1000, 3);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true, true, true]);
          }
          const tradingPairEncoded = numberToBytesX(tradingPairToCancel, 20);
          await dummyExchange1.setTradingPairCutoffs(user1, tradingPairEncoded, 2000);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [false, true, true]);
          }
        });

        it("owner should not be able to cancel an order created by its broker", async () => {
          const orderHashOwnerToCancel = 123;
          const orders: Order[] = [];
          addOrder(orders, broker1, user1, 123, 1000, orderHashOwnerToCancel);
          const data = toCutoffBatch(orders);
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true]);
          }
          await dummyExchange1.setCancelled(user1, numberToBytesX(orderHashOwnerToCancel, 32));
          {
            const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data, {from: owner});
            assertOrdersValid(result, [true]);
          }
        });

      });
    });

    describe("Bad ERC20 tokens", () => {
      it("batchTransfer should succeed when a token transfer does not throw and returns nothing", async () => {
        await TestToken.setTestCase(await TestToken.TEST_NO_RETURN_VALUE());
        await setERC20UserBalance(testToken, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, testToken, user1, user2, 1e18);
        await batchTransferChecked(transfers);
      });

      it("batchTransfer should fail when a token transfer 'require' fails", async () => {
        await TestToken.setTestCase(await TestToken.TEST_REQUIRE_FAIL());
        await setERC20UserBalance(testToken, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, testToken, user1, user2, 1e18);
        const batch = toTransferBatch(transfers);
        await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
      });

      it("batchTransfer should fail when a token transfer returns false", async () => {
        await TestToken.setTestCase(await TestToken.TEST_RETURN_FALSE());
        await setERC20UserBalance(testToken, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, testToken, user1, user2, 1e18);
        const batch = toTransferBatch(transfers);
        await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
      });

      it("batchTransfer should fail when a token transfer returns more than 32 bytes", async () => {
        await TestToken.setTestCase(await TestToken.TEST_INVALID_RETURN_SIZE());
        await setERC20UserBalance(testToken, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC20TokenTransfer(transfers, testToken, user1, user2, 1e18);
        const batch = toTransferBatch(transfers);
        await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
      });
    });

    describe("Bad ERC1400 tokens", () => {
      it("batchTransfer should fail when a token transfer 'require' fails", async () => {
        await SecTestToken.setTestCase(await SecTestToken.TEST_SEND_REQUIRE_FAIL());
        await setERC1400UserBalance(secTestToken, tranche1, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC1400TokenTransfer(transfers, secTestToken, user1, user2, 1e18, tranche1, "0x");
        const batch = toTransferBatch(transfers);
        await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
      });

      it("batchTransfer should fail when a token transfer returns false", async () => {
        await SecTestToken.setTestCase(await SecTestToken.TEST_SEND_RETURN_FALSE());
        await setERC1400UserBalance(secTestToken, tranche1, user1, 10e18);
        const transfers: TokenTransfer[] = [];
        addERC1400TokenTransfer(transfers, secTestToken, user1, user2, 1e18, tranche1, "0x");
        const batch = toTransferBatch(transfers);
        await expectThrow(dummyExchange1.batchTransfer(batch), "TRANSFER_FAILURE");
      });
    });

  });

  describe("anyone", () => {
    it("should be able to check if order cutoffs are valid", async () => {
      const orders: Order[] = [];
      addOrder(orders, broker1, user1, 123, 1000, 123);
      const data = toCutoffBatch(orders);
      const result = await tradeDelegate.batchGetFilledAndCheckCancelled(data);
      assertOrdersValid(result, [true]);
    });

    it("should not be able to check if order cutoffs are valid with malformed data", async () => {
      const orders: Order[] = [];
      addOrder(orders, broker1, user1, 123, 1000, 123);
      const data = toCutoffBatch(orders);
      data.pop();
      await expectThrow(tradeDelegate.batchGetFilledAndCheckCancelled(data), "INVALID_SIZE");
    });

    it("should not be able to transfer tokens", async () => {
      // Make sure everyone has enough funds
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      await expectThrow(batchTransferChecked(transfers), "UNAUTHORIZED");
    });

    it("should not be able to batch update filled", async () => {
      const hash1 = 123;
      const updates: FilledUpdate[] = [];
      addFilledUpdate(updates, hash1, 1.5e18);
      await expectThrow(batchUpdateFilledChecked(updates), "UNAUTHORIZED");
    });
  });
});
