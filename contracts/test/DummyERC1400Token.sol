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

import "./ERC1400Token.sol";


/// @author Brecht Devos - <brecht@loopring.org>
contract DummyERC1400Token is ERC1400Token {

    constructor(
        string _name,
        string _symbol,
        uint   _totalSupply
    ) ERC1400Token(
        _name,
        _symbol,
        _totalSupply,
        msg.sender
        )
        public
    {
    }

    function setBalance(
        address _target,
        bytes32 _tranche,
        uint _value
        )
        public
    {
        byte success = mint(_tranche, _target, _value, new bytes(0));
        require(success == 0x01, "mint needs to succeed");
    }

    function addBalance(
        address _target,
        bytes32 _tranche,
        uint _value
        )
        public
    {
        byte success = mint(_tranche, _target, _value, new bytes(0));
        require(success == 0x01, "mint needs to succeed");
    }

}
