var TradeDelegate = artifacts.require("./impl/TradeDelegate");
var TradeHistory = artifacts.require("./impl/TradeHistory");
var BrokerRegistry = artifacts.require("./impl/BrokerRegistry");
var OrderRegistry = artifacts.require("./impl/OrderRegistry");
var RingSubmitter = artifacts.require("./impl/RingSubmitter");
var OrderCanceller = artifacts.require("./impl/OrderCanceller");
var FeeHolder = artifacts.require("./impl/FeeHolder");
var OrderBook = artifacts.require("./impl/OrderBook");
var BurnRateTable = artifacts.require("./impl/BurnRateTable");
var BurnManager = artifacts.require("./impl/BurnManager");
var LRCToken = artifacts.require("./test/tokens/LRC.sol");
var GTOToken = artifacts.require("./test/tokens/GTO.sol");
var WETHToken = artifacts.require("./test/tokens/WETH.sol");

module.exports = async function(deployer, network, accounts) {

  if (network === "live") {
    // ignore.
  } else {
    const [
      delegate,
      history,
    ] = await Promise.all([
      TradeDelegate.deployed(),
      TradeHistory.deployed(),
      BrokerRegistry.deployed(),
      OrderRegistry.deployed(),
      FeeHolder.deployed(),
      OrderBook.deployed(),
    ]);

    // test tokens:
    const tokens = await Promise.all([
      LRCToken.deployed(),
      WETHToken.deployed(),
      GTOToken.deployed(),
    ]);      

    await deployer.deploy(BurnRateTable, LRCToken.address, WETHToken.address);
    await deployer.deploy(
      RingSubmitter,
      LRCToken.address,
      WETHToken.address,
      TradeDelegate.address,
      TradeHistory.address,
      BrokerRegistry.address,
      OrderRegistry.address,
      FeeHolder.address,
      OrderBook.address,
      BurnRateTable.address,
    );
    await deployer.deploy(OrderCanceller, TradeHistory.address);
    await deployer.deploy(BurnManager, FeeHolder.address, LRCToken.address);

    // do authorize:
    await delegate.authorizeAddress(RingSubmitter.address, {from: accounts[0]});
    await history.authorizeAddress(RingSubmitter.address, {from: accounts[0]});
    await history.authorizeAddress(OrderCanceller.address, {from: accounts[0]});

    // set balance and approve.
    const maxValue = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    for (const t of tokens) {
      await t.setBalance(accounts[0], maxValue);
      await t.approve(TradeDelegate.address, maxValue, {from: accounts[0]});
    }

    // print addresses:
    console.log("LRCToken.address", LRCToken.address);
    console.log("WETHToken.address",WETHToken.address);
    console.log("GTO.address",GTOToken.address);
    console.log("TradeDelegate.address",TradeDelegate.address);
    console.log("TradeHistory.address",TradeHistory.address);
    console.log("BrokerRegistry.address",BrokerRegistry.address);
    console.log("OrderRegistry.address",OrderRegistry.address);
    console.log("FeeHolder.address",FeeHolder.address);
    console.log("OrderBook.address",OrderBook.address);
    console.log("BurnRateTable.address",BurnRateTable.address);
    console.log("RingSubmitter.address",RingSubmitter.address);
    console.log("OrderCanceller.address",OrderCanceller.address);
    console.log("BurnManager.address",BurnManager.address);
  }
};
