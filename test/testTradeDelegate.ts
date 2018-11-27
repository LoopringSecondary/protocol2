import { BigNumber } from "bignumber.js";
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

contract("TradeDelegate", (accounts: string[]) => {
  const owner = accounts[0];
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

  before(async () => {
    erc20Token1 = LRCToken.address;
    erc20Token2 = WETHToken.address;
    erc20Token3 = RDNToken.address;
    erc20Token4 = GTOToken.address;
    erc1400Token1 = STAToken.address;
    erc1400Token2 = STBToken.address;
  });

  beforeEach(async () => {
    tradeDelegate = await TradeDelegate.new();
    dummyExchange1 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0", "0x0");
    dummyExchange2 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0", "0x0");
    dummyExchange3 = await DummyExchange.new(tradeDelegate.address, "0x0", "0x0", "0x0");
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
    it("should not be able to transfer tokens", async () => {
      // Make sure everyone has enough funds
      await setERC20UserBalance(erc20Token1, user1, 10e18);
      const transfers: TokenTransfer[] = [];
      addERC20TokenTransfer(transfers, erc20Token1, user1, user2, 1e18);
      await expectThrow(batchTransferChecked(transfers), "UNAUTHORIZED");
    });
  });
});
