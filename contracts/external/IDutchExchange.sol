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


/// @author Brecht Devos - <brecht@loopring.org>
/// @title IDutchExchange - Interface for the DutchX.
contract IDutchExchange {

    // Token => user => amount
    // balances stores a user's balance in the DutchX
    mapping (address => mapping (address => uint)) public balances;

    function depositAndSell(
        address sellToken,
        address buyToken,
        uint amount
        )
        external
        returns (uint newBal, uint auctionIndex, uint newSellerBal);

    function claimTokensFromSeveralAuctionsAsSeller(
        address[] auctionSellTokens,
        address[] auctionBuyTokens,
        uint[] auctionIndices,
        address user
        )
        external;

    function withdraw(
        address tokenAddress,
        uint amount
        )
        public
        returns (uint);

}
