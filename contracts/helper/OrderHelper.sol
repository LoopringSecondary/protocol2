/*

  Copyright 2017 Loopring Project Ltd (Loopring Foundation).

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/
pragma solidity 0.4.24;
pragma experimental "v0.5.0";
pragma experimental "ABIEncoderV2";

import "../impl/BrokerInterceptorProxy.sol";
import "../impl/Data.sol";
import "../lib/ERC20.sol";
import "../lib/MathUint.sol";
import "../lib/MultihashUtil.sol";


/// @title OrderHelper
/// @author Daniel Wang - <daniel@loopring.org>.
library OrderHelper {
    using MathUint      for uint;
    using BrokerInterceptorProxy for address;

    // Data to calculate 0x order hashes
    address constant internal ZRX_EXCHANGE_ADDRESS = 0x48BaCB9266a570d521063EF5dD96e61686DbE788;
    string constant internal EIP191_HEADER = "\x19\x01";
    string constant internal ZRX_EIP712_DOMAIN_NAME = "0x Protocol";
    string constant internal ZRX_EIP712_DOMAIN_VERSION = "2";
    bytes32 constant internal ZRX_EIP712_DOMAIN_SEPARATOR_SCHEMA_HASH = keccak256(
        abi.encodePacked(
            "EIP712Domain(",
            "string name,",
            "string version,",
            "address verifyingContract",
            ")"
        )
    );
    bytes32 constant internal ZRX_EIP712_ORDER_SCHEMA_HASH = keccak256(
        abi.encodePacked(
            "Order(",
            "address makerAddress,",
            "address takerAddress,",
            "address feeRecipientAddress,",
            "address senderAddress,",
            "uint256 makerAssetAmount,",
            "uint256 takerAssetAmount,",
            "uint256 makerFee,",
            "uint256 takerFee,",
            "uint256 expirationTimeSeconds,",
            "uint256 salt,",
            "bytes makerAssetData,",
            "bytes takerAssetData",
            ")"
        )
    );

    function updateHash(Data.Order order)
        internal
        pure
    {
        if (order.version == 0) {
            calculateHash(order);
        } else if(order.version == 1) {
            calculateZrxHash(order);
        } else {
            require(false, "INVALID_ORDER_VERSION");
        }
    }


    function calculateHash(Data.Order order)
        internal
        pure
    {
        /* order.hash = keccak256( */
        /*     abi.encodePacked( */
        /*         order.amountS, */
        /*         order.amountB, */
        /*         order.feeAmount, */
        /*         order.validSince, */
        /*         order.validUntil, */
        /*         order.owner, */
        /*         order.tokenS, */
        /*         order.tokenB, */
        /*         order.dualAuthAddr, */
        /*         order.broker, */
        /*         order.orderInterceptor, */
        /*         order.wallet, */
        /*         order.tokenRecipient */
        /*         order.feeToken, */
        /*         order.walletSplitPercentage, */
        /*         order.tokenSFeePercentage, */
        /*         order.tokenBFeePercentage, */
        /*         order.allOrNone */
        /*     ) */
        /* ); */
        bytes32 hash;
        assembly {
            // Load the free memory pointer
            let ptr := mload(64)

            // We store the members back to front so we can overwrite data for members smaller than 32
            // (mstore always writes 32 bytes)
            mstore(add(ptr, sub(346, 31)), mload(add(order, 576)))   // order.allOrNone
            mstore(add(ptr, sub(344, 30)), mload(add(order, 736)))   // order.tokenBFeePercentage
            mstore(add(ptr, sub(342, 30)), mload(add(order, 704)))   // order.tokenSFeePercentage
            mstore(add(ptr, sub(340, 30)), mload(add(order, 800)))   // order.walletSplitPercentage
            mstore(add(ptr, sub(320, 12)), mload(add(order, 608)))   // order.feeToken
            mstore(add(ptr, sub(300, 12)), mload(add(order, 768)))   // order.tokenRecipient
            mstore(add(ptr, sub(280, 12)), mload(add(order, 448)))   // order.wallet
            mstore(add(ptr, sub(260, 12)), mload(add(order, 416)))   // order.orderInterceptor
            mstore(add(ptr, sub(240, 12)), mload(add(order, 320)))   // order.broker
            mstore(add(ptr, sub(220, 12)), mload(add(order, 288)))   // order.dualAuthAddr
            mstore(add(ptr, sub(200, 12)), mload(add(order,  96)))   // order.tokenB
            mstore(add(ptr, sub(180, 12)), mload(add(order,  64)))   // order.tokenS
            mstore(add(ptr, sub(160, 12)), mload(add(order,  32)))   // order.owner
            mstore(add(ptr, sub(128,  0)), mload(add(order, 480)))   // order.validUntil
            mstore(add(ptr, sub( 96,  0)), mload(add(order, 192)))   // order.validSince
            mstore(add(ptr, sub( 64,  0)), mload(add(order, 640)))   // order.feeAmount
            mstore(add(ptr, sub( 32,  0)), mload(add(order, 160)))   // order.amountB
            mstore(add(ptr, sub(  0,  0)), mload(add(order, 128)))   // order.amountS

            hash := keccak256(ptr, 347)  // 5*32 + 9*20 + 3*2 + 1*1
        }
        order.hash = hash;
    }

    function calculateZrxHash(Data.Order order)
        internal
        pure
    {
        // ERC20 tokens are stored like this in 0x orders:
        // abi.simpleEncode('ERC20Token(address)', tokenAddress)
        bytes32 makerAssetDataHash;
        bytes32 takerAssetDataHash;
        assembly {
            let data := mload(0x40)
            mstore(data, 36)
            data := add(data, 32)
            mstore(data, 0xf47261b000000000000000000000000000000000000000000000000000000000)
            mstore(add(data, 4), mload(add(order, 64)))                                // order.tokenS
            makerAssetDataHash := keccak256(data, 36)
            mstore(add(data, 4), mload(add(order, 96)))                                // order.tokenB
            takerAssetDataHash := keccak256(data, 36)
        }

        order.hash = keccak256(
            abi.encodePacked(
                ZRX_EIP712_ORDER_SCHEMA_HASH,
                bytes32(order.owner),                                                  // makerAddress
                bytes32(0x0),                                                          // takerAddress
                bytes32(order.wallet),                                                 // feeRecipientAddress
                bytes32(0x0),                                                          // senderAddress
                order.amountS,                                                         // makerAssetAmount
                order.amountB,                                                         // takerAssetAmount
                order.feeAmount,                                                       // makerFee
                uint(0),                                                               // takerFee
                (order.validUntil == 0) ? 0 : order.validUntil - order.validSince,     // expirationTimeSeconds
                order.validSince,                                                      // salt
                makerAssetDataHash,                                                    // keccak256(makerAssetData)
                takerAssetDataHash                                                     // keccak256(takerAssetData)
            )
        );

        bytes32 domainHash = keccak256(
            abi.encodePacked(
                ZRX_EIP712_DOMAIN_SEPARATOR_SCHEMA_HASH,
                keccak256(bytes(ZRX_EIP712_DOMAIN_NAME)),
                keccak256(bytes(ZRX_EIP712_DOMAIN_VERSION)),
                bytes32(ZRX_EXCHANGE_ADDRESS)
            )
        );
        order.hash = keccak256(
            abi.encodePacked(
                EIP191_HEADER,
                domainHash,
                order.hash
            )
        );

        // Verify order data not contained in 0x order hashes to ensure
        // 0x exchange like behaviour for the order
        order.valid = order.valid && (order.tokenRecipient == order.owner);
        // order.valid = order.valid && (order.feeToken == ctx.zrxTokenAddress);
        order.valid = order.valid && (order.walletSplitPercentage == 100);
        order.valid = order.valid && (order.dualAuthAddr == 0x0);
        order.valid = order.valid && (order.broker == 0x0);
        order.valid = order.valid && (order.allOrNone == false);
        order.valid = order.valid && (order.tokenSFeePercentage == 0);
        order.valid = order.valid && (order.tokenBFeePercentage == 0);
    }

    function updateBrokerAndInterceptor(
        Data.Order order,
        Data.Context ctx
        )
        internal
        view
    {
        if (order.broker == 0x0) {
            order.broker = order.owner;
        } else {
            bool registered;
            (registered, /*order.brokerInterceptor*/) = ctx.orderBrokerRegistry.getBroker(
                order.owner,
                order.broker
            );
            order.valid = order.valid && registered;
        }
    }

    function check(
        Data.Order order,
        Data.Context ctx
        )
        internal
        view
    {
        // If the order was already partially filled
        // we don't have to check all of the infos and the signature again
        if(order.filledAmountS == 0) {
            validateAllInfo(order, ctx);
            checkBrokerSignature(order, ctx);
        } else {
            validateUnstableInfo(order, ctx);
        }

        checkP2P(order);
    }

    function validateAllInfo(
        Data.Order order,
        Data.Context ctx
        )
        internal
        view
    {
        bool valid = true;
        // valid = valid && (order.version == 0); // unsupported order version
        valid = valid && (order.owner != 0x0); // invalid order owner
        valid = valid && (order.tokenS != 0x0); // invalid order tokenS
        valid = valid && (order.tokenB != 0x0); // invalid order tokenB
        valid = valid && (order.amountS != 0); // invalid order amountS
        valid = valid && (order.amountB != 0); // invalid order amountB
        valid = valid && (order.feeToken != 0x0); // invalid fee token

        valid = valid && (order.tokenSFeePercentage < ctx.feePercentageBase); // invalid tokenS percentage
        valid = valid && (order.tokenBFeePercentage < ctx.feePercentageBase); // invalid tokenB percentage
        valid = valid && (order.walletSplitPercentage <= 100); // invalid wallet split percentage

        valid = valid && (order.validSince <= now); // order is too early to match

        order.valid = order.valid && valid;

        validateUnstableInfo(order, ctx);
    }


    function validateUnstableInfo(
        Data.Order order,
        Data.Context ctx
        )
        internal
        view
    {
        bool valid = true;
        valid = valid && (order.validUntil == 0 || order.validUntil > now);  // order is expired
        valid = valid && (order.waiveFeePercentage <= int16(ctx.feePercentageBase)); // invalid waive percentage
        valid = valid && (order.waiveFeePercentage >= -int16(ctx.feePercentageBase)); // invalid waive percentage
        if (order.dualAuthAddr != 0x0) { // if dualAuthAddr exists, dualAuthSig must be exist.
            valid = valid && (order.dualAuthSig.length > 0);
        }
        order.valid = order.valid && valid;
    }


    function checkP2P(
        Data.Order order
        )
        internal
        pure
    {
        order.P2P = (order.tokenSFeePercentage > 0 || order.tokenBFeePercentage > 0);
    }


    function checkBrokerSignature(
        Data.Order order,
        Data.Context ctx
        )
        internal
        view
    {
        if (order.sig.length == 0) {
            bool registered = ctx.orderRegistry.isOrderHashRegistered(
                order.broker,
                order.hash
            );

            if (!registered) {
                order.valid = order.valid && ctx.orderBook.orderSubmitted(order.hash);
            }
        } else {
            order.valid = order.valid && MultihashUtil.verifySignature(
                order.broker,
                order.hash,
                order.sig
            );
        }
    }

    function checkDualAuthSignature(
        Data.Order order,
        bytes32  miningHash
        )
        internal
        pure
    {
        if (order.dualAuthSig.length != 0) {
            order.valid = order.valid && MultihashUtil.verifySignature(
                order.dualAuthAddr,
                miningHash,
                order.dualAuthSig
            );
        }
    }

    function validateAllOrNone(
        Data.Order order
        )
        internal
        pure
    {
        // Check if this order needs to be completely filled
        if(order.allOrNone) {
            order.valid = order.valid && (order.filledAmountS == order.amountS);
        }
    }

    function getSpendableS(
        Data.Order order,
        Data.Context ctx
        )
        internal
        returns (uint)
    {
        return getSpendable(
            ctx.delegate,
            order.tokenS,
            order.owner,
            order.broker,
            order.brokerInterceptor,
            order.tokenSpendableS,
            order.brokerSpendableS
        );
    }

    function getSpendableFee(
        Data.Order order,
        Data.Context ctx
        )
        internal
        returns (uint)
    {
        return getSpendable(
            ctx.delegate,
            order.feeToken,
            order.owner,
            order.broker,
            order.brokerInterceptor,
            order.tokenSpendableFee,
            order.brokerSpendableFee
        );
    }

    function reserveAmountS(
        Data.Order order,
        uint amount
        )
        internal
        pure
    {
        order.tokenSpendableS.reserved += amount;
        if (order.brokerInterceptor != 0x0) {
            order.brokerSpendableS.reserved += amount;
        }
    }

    function reserveAmountFee(
        Data.Order order,
        uint amount
        )
        internal
        pure
    {
        order.tokenSpendableFee.reserved += amount;
        if (order.brokerInterceptor != 0x0) {
            order.brokerSpendableFee.reserved += amount;
        }
    }

    function resetReservations(
        Data.Order order
        )
        internal
        pure
    {
        order.tokenSpendableS.reserved = 0;
        order.tokenSpendableFee.reserved = 0;
        if (order.brokerInterceptor != 0x0) {
            order.brokerSpendableS.reserved = 0;
            order.brokerSpendableFee.reserved = 0;
        }
    }

    /// @return Amount of ERC20 token that can be spent by this contract.
    function getERC20Spendable(
        ITradeDelegate delegate,
        address tokenAddress,
        address owner
        )
        private
        view
        returns (uint spendable)
    {
        ERC20 token = ERC20(tokenAddress);
        spendable = token.allowance(
            owner,
            address(delegate)
        );
        if (spendable == 0) {
            return;
        }
        uint balance = token.balanceOf(owner);
        spendable = (balance < spendable) ? balance : spendable;
    }

    /// @return Amount of ERC20 token that can be spent by the broker
    function getBrokerAllowance(
        address tokenAddress,
        address owner,
        address broker,
        address brokerInterceptor
        )
        private
        returns (uint allowance)
    {
        allowance = brokerInterceptor.getAllowanceSafe(
            owner,
            broker,
            tokenAddress
        );
    }

    function getSpendable(
        ITradeDelegate delegate,
        address tokenAddress,
        address owner,
        address broker,
        address brokerInterceptor,
        Data.Spendable tokenSpendable,
        Data.Spendable brokerSpendable
        )
        private
        returns (uint spendable)
    {
        if (!tokenSpendable.initialized) {
            tokenSpendable.amount = getERC20Spendable(
                delegate,
                tokenAddress,
                owner
            );
            tokenSpendable.initialized = true;
        }
        spendable = tokenSpendable.amount.sub(tokenSpendable.reserved);
        if (brokerInterceptor != 0x0) {
            if (!brokerSpendable.initialized) {
                brokerSpendable.amount = getBrokerAllowance(
                    tokenAddress,
                    owner,
                    broker,
                    brokerInterceptor
                );
                brokerSpendable.initialized = true;
            }
            uint brokerSpendableAmount = brokerSpendable.amount.sub(brokerSpendable.reserved);
            spendable = (brokerSpendableAmount < spendable) ? brokerSpendableAmount : spendable;
        }
    }
}
