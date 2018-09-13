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

import "../impl/Data.sol";

/// @title Calculate and verify the order's hash according to the EIP712 standard 
/// @author autumn84 - <yangli@loopring.org>
contract EIP712 {
    
    struct EIP712Domain {
        string  name;
        string  version;
        address verifyingContract;
    }

    bytes32 constant EIP712DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,address verifyingContract)"
    );

    bytes32 constant ORDER_TYPEHASH = keccak256(abi.encodePacked(
        "Order(",
        "address owner,",
        "address tokenS,",
        "address tokenB,",
        "uint amountS,",
        "uint amountB,",
        "address dualAuthAddr,",
        "address broker,",
        "address orderInterceptor,",
        "address wallet,",
        "uint validSince,",
        "uint validUntil,",
        "bool allOrNone,",
        "address tokenRecipient,",
        "uint16 walletSplitPercentage,",
        "address feeToken",
        "uint feeAmount",
        "uint16 feePercentage",
        "uint16 tokenSFeePercentage",
        "uint16 tokenBFeePercentage",
        ")"
    ));

    bytes32 DOMAIN_SEPARATOR;

    constructor () public {
        DOMAIN_SEPARATOR = hash(EIP712Domain({
            name: "Loopring",
            version: '2.0',
            // verifyingContract: this
            verifyingContract: address(this)
        }));
    }

    function hash(EIP712Domain eip712Domain) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            EIP712DOMAIN_TYPEHASH,
            keccak256(bytes(eip712Domain.name)),
            keccak256(bytes(eip712Domain.version)),
            eip712Domain.verifyingContract
        ));
    }

    function hash(Data.Order order) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            ORDER_TYPEHASH,
            order.owner,
            order.tokenS,
            order.tokenB,
            order.amountS,
            order.amountB,
            order.dualAuthAddr,
            order.broker,
            order.orderInterceptor,
            order.wallet,
            order.validSince,
            order.validUntil,
            order.allOrNone,
            order.tokenRecipient,
            order.walletSplitPercentage,
            order.feeToken,
            order.feeAmount,
            order.feePercentage,
            order.tokenSFeePercentage,
            order.tokenBFeePercentage
        ));
    }

    function verify(Data.Order order, uint8 v, bytes32 r, bytes32 s) internal view returns (bool) {
        // Note: we need to use `encodePacked` here instead of `encode`.
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            hash(order)
        ));
        return ecrecover(digest, v, r, s) == order.owner;
    }
}