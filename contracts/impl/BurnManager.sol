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

import "../external/IDutchExchange.sol";
import "../iface/IFeeHolder.sol";
import "../lib/BurnableERC20.sol";
import "../lib/MathUint.sol";
import "../lib/NoDefaultFunc.sol";


/// @author Brecht Devos - <brecht@loopring.org>
contract BurnManager is NoDefaultFunc {
    using MathUint for uint;

    event Auction(uint indexed auctionIndex, address indexed token, uint amount);

    address public feeHolderAddress = 0x0;
    address public lrcAddress = 0x0;
    address public dutchExchangeAddress = 0x0;

    constructor(
        address _feeHolderAddress,
        address _lrcAddress,
        address _dutchExchangeAddress
        )
        public
    {
        require(_feeHolderAddress != 0x0, ZERO_ADDRESS);
        require(_lrcAddress != 0x0, ZERO_ADDRESS);
        // require(_dutchExchangeAddress != 0x0, ZERO_ADDRESS);
        feeHolderAddress = _feeHolderAddress;
        lrcAddress = _lrcAddress;
        dutchExchangeAddress = _dutchExchangeAddress;
    }

    function burn(
        address token
        )
        external
        returns (bool)
    {
        IFeeHolder feeHolder = IFeeHolder(feeHolderAddress);

        // Withdraw the complete token balance
        uint balance = feeHolder.feeBalances(token, feeHolderAddress);
        bool success = feeHolder.withdrawBurned(token, balance);
        require(success, WITHDRAWAL_FAILURE);

        if (token != lrcAddress) {
            // Use DutchX to sell the tokens
            IDutchExchange dutchExchange = IDutchExchange(dutchExchangeAddress);
            BurnableERC20(token).approve(dutchExchangeAddress, balance);
            (
                /*uint newBalance*/,
                uint auctionIndex,
                /*uint newSellerBal*/
            ) = dutchExchange.depositAndSell(token, lrcAddress, balance);
            emit Auction(auctionIndex, token, balance);
        } else {
            // Burn the LRC
            _burn(balance);
        }

        return true;
    }

    function burnAuctioned(
        address[] auctionSellTokens,
        uint[] auctionIndices
        )
        public
        returns (bool)
    {
        require(auctionSellTokens.length == auctionIndices.length, INVALID_VALUE);

        // We always sell to LRC
        address[] memory auctionBuyTokens = new address[](auctionSellTokens.length);
        for (uint i = 0; i < auctionSellTokens.length; i++) {
            auctionBuyTokens[i] = lrcAddress;
        }

        // Claim the LRC we bought
        IDutchExchange dutchExchange = IDutchExchange(dutchExchangeAddress);
        dutchExchange.claimTokensFromSeveralAuctionsAsSeller(
            auctionSellTokens,
            auctionBuyTokens,
            auctionIndices,
            this
        );

        // Withdraw the LRC
        uint balance = dutchExchange.balances(lrcAddress, this);
        uint newBalance = dutchExchange.withdraw(lrcAddress, balance);
        require(newBalance == 0, INVALID_STATE);

        // Burn the LRC
        _burn(balance);

        return true;
    }

    function _burn(
        uint amount
        )
        internal
    {
        require(BurnableERC20(lrcAddress).burn(amount), BURN_FAILURE);
    }

}
