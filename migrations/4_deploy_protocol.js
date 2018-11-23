var TradeDelegate = artifacts.require("./impl/TradeDelegate");
var BrokerRegistry = artifacts.require("./impl/BrokerRegistry");
var OrderRegistry = artifacts.require("./impl/OrderRegistry");
var RingSubmitter = artifacts.require("./impl/RingSubmitter");
var OrderCanceller = artifacts.require("./impl/OrderCanceller");
var FeeHolder = artifacts.require("./impl/FeeHolder");
var OrderBook = artifacts.require("./impl/OrderBook");
var BurnRateTable = artifacts.require("./impl/BurnRateTable");
var BurnManager = artifacts.require("./impl/BurnManager");

module.exports = function(deployer, network, accounts) {

  const lrc = "0xcd36128815ebe0b44d0374649bad2721b8751bef";
  const weth = "0xf079E0612E869197c5F4c7D0a95DF570B163232b";

  if (network === "live") {
    // ignore.
  } else {
    deployer.then(() => {
      return Promise.all([
        TradeDelegate.deployed(),
        BrokerRegistry.deployed(),
        OrderRegistry.deployed(),
        FeeHolder.deployed(),
        OrderBook.deployed(),
        lrc,
        weth,
      ]);
    }).then(() => {
      return deployer.deploy(BurnRateTable, lrc, weth);
    }).then(() => {
      return Promise.all([
        deployer.deploy(
          RingSubmitter,
          lrc,
          weth,
          TradeDelegate.address,
          BrokerRegistry.address,
          OrderRegistry.address,
          FeeHolder.address,
          OrderBook.address,
          BurnRateTable.address,
        ),
        deployer.deploy(OrderCanceller, TradeDelegate.address),
        deployer.deploy(BurnManager, FeeHolder.address, lrc),
      ]);
    }).then(() => {
      // do nothing
    });
  }
};
