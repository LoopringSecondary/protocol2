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

import "../iface/IFeeHolder.sol";
import "../iface/ITradeDelegate.sol";
import "../lib/Claimable.sol";
import "../lib/ERC20SafeTransfer.sol";
import "../lib/MathUint.sol";
import "../lib/NoDefaultFunc.sol";

/// @author Kongliang Zhong - <kongliang@loopring.org>
contract FeeHolder is IFeeHolder, NoDefaultFunc {
    using MathUint for uint;
    using ERC20SafeTransfer for address;

    address public delegateAddress = 0x0;

    constructor(address _delegateAddress) public {
        require(_delegateAddress != 0x0);
        delegateAddress = _delegateAddress;
    }

    modifier onlyAuthorized() {
        ITradeDelegate delegate = ITradeDelegate(delegateAddress);
        bool isAuthorized = delegate.isAddressAuthorized(msg.sender);
        require(isAuthorized, "unauthorized address");
        _;
    }

    function batchAddFeeBalances(bytes32[] batch)
        onlyAuthorized
        external
    {
        require(batch.length % 3 == 0, "invalid array length");
        for (uint i = 0; i < batch.length; i += 3) {
            address token = address(batch[i]);
            address owner = address(batch[i + 1]);
            uint value = uint(batch[i + 2]);
            feeBalances[token][owner] = feeBalances[token][owner].add(value);
        }
    }

    function withdrawToken(address token, uint value)
        external
        returns (bool success)
    {
        require(feeBalances[token][msg.sender] >= value);
        feeBalances[token][msg.sender] = feeBalances[token][msg.sender].sub(value);
        success = token.safeTransfer(msg.sender, value);
        emit TokenWithdrawn(msg.sender, token, value);
    }

}