var RingSubmitter = artifacts.require("./impl/RingSubmitter");
var TradeDelegate = artifacts.require("./impl/TradeDelegate");
var TradeHistory = artifacts.require("./impl/TradeHistory");
var FeeHolder = artifacts.require("./impl/FeeHolder");
var DummyBrokerInterceptor = artifacts.require("./test/DummyBrokerInterceptor");
var DummyExchange = artifacts.require("./test/DummyExchange");
var DummyBurnManager = artifacts.require("./test/DummyBurnManager");
var LRCToken = artifacts.require("./test/tokens/LRC.sol");
var DeserializerTest = artifacts.require("./test/DeserializerTest.sol");

// migrateDx
//  * Is a migration script made for deploying DutchX in a local-ganache test
//    environment in a simpler way
//  * For more details check out:
//    https://github.com/gnosis/dx-contracts/blob/master/src/migrations/index.js
const migrateDx = require("@gnosis.pm/dx-contracts/src/migrations");

module.exports = function(deployer, network, accounts) {
  if (network === "live" || network === "ropsten" || network === "rinkeby") {
    // ignore.
  } else {
    deployer.then(() => {
      return Promise.all([
        RingSubmitter.deployed(),
        TradeDelegate.deployed(),
        TradeHistory.deployed(),
        FeeHolder.deployed(),
        RingSubmitter.deployed(),
        LRCToken.deployed(),
      ]);
    }).then((contracts) => {
      return Promise.all([
        deployer.deploy(DeserializerTest, LRCToken.address),
        deployer.deploy(DummyBrokerInterceptor, RingSubmitter.address),
        deployer.deploy(DummyExchange, TradeDelegate.address, TradeHistory.address,
                        FeeHolder.address, RingSubmitter.address),
        deployer.deploy(DummyBurnManager, FeeHolder.address),
      ]);
    }).then((contracts) => {
      return migrateDx({
        accounts,
        artifacts,
        deployer,
        network,
        thresholdAuctionStartUsd: process.env.THRESHOLD_AUCTION_START_USD,
        thresholdNewTokenPairUsd: process.env.THRESHOLD_NEW_TOKEN_PAIR_USD,
        web3,
      });
    });
  }
};
