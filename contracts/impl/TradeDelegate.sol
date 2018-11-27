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


import "../iface/ITradeDelegate.sol";
import "../lib/Authorizable.sol";
import "../lib/ERC1400.sol";
import "../lib/ERC20SafeTransfer.sol";
import "../lib/Killable.sol";
import "../lib/NoDefaultFunc.sol";
import "./Data.sol";


/// @title An Implementation of ITradeDelegate.
/// @author Daniel Wang - <daniel@loopring.org>.
/// @author Kongliang Zhong - <kongliang@loopring.org>.
contract TradeDelegate is ITradeDelegate, Authorizable, Killable, NoDefaultFunc {
    using ERC20SafeTransfer for address;

    function batchTransfer(
        bytes/* batch*/
        )
        external
        onlyAuthorized
        notSuspended
    {
        // Because this function is external we cannot directly use a bytes parameters
        // without manually copying it to from callData to memory
        uint batchPtr;
        uint batchLength;
        assembly {
            batchLength := calldataload(36)
            batchPtr := mload(0x40)
            calldatacopy(batchPtr, 68, batchLength)
            mstore(0x40, add(batchPtr, batchLength))
        }
        uint start = batchPtr;
        uint end = start + batchLength;
        uint p = start;
        while(p < end) {
            address token;
            address from;
            address to;
            uint amount;
            Data.TokenType tokenType;
            bytes32 tranche;
            bytes memory transferData;
            assembly {
                token := mload(add(p,  0))
                from := mload(add(p, 32))
                to := mload(add(p, 64))
                amount := mload(add(p, 96))
                tokenType := mload(add(p, 128))
                tranche := mload(add(p, 160))
                transferData := add(p, 192)
            }
            p += 224 + transferData.length;
            if (tokenType == Data.TokenType.ERC20) {
                require(
                    token.safeTransferFrom(
                        from,
                        to,
                        amount
                    ),
                    TRANSFER_FAILURE
                );
            } else if (tokenType == Data.TokenType.ERC1400) {
                (byte ESC, ) = ERC1400(token).operatorSendTranche(
                    tranche,
                    from,
                    to,
                    amount,
                    transferData,
                    new bytes(0)
                );
                require(ESC == 0x01, TRANSFER_FAILURE);
            }
        }
        require(p == end, INVALID_SIZE);
    }
}
