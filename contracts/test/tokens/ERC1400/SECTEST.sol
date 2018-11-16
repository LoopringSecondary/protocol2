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

import "../../DummyERC1400Token.sol";

/// @author Brecht Devos - <brecht@loopring.org>
contract SECTEST is DummyERC1400Token {

    // Test cases
    uint8 public constant TEST_NOTHING = 0;
    uint8 public constant TEST_CANSEND_FALSE = 1;
    uint8 public constant TEST_SEND_DIFFERENT_TRANCHE = 2;
    uint8 public constant TEST_SEND_RETURN_FALSE = 3;
    uint8 public constant TEST_SEND_REQUIRE_FAIL = 4;

    uint public testCase = TEST_NOTHING;
    bytes32 public destinationTranche = 0x0;

    constructor() DummyERC1400Token(
        "SECURITY_TOKEN_TEST",
        "SECTEST",
        10 ** 27
    ) public
    {
    }

    // Transfer Validity
    function canSend(
        address _from,
        address _to,
        bytes32 _tranche,
        uint256 _amount,
        bytes _data
        )
        external
        view
        returns (byte code, bytes32 description, bytes32 destTranche)
    {
        if (testCase == TEST_CANSEND_FALSE) {
            code = 0x00;
        } else {
            code = 0x01;
        }
        description = 0x0;
        if (testCase == TEST_SEND_DIFFERENT_TRANCHE) {
            destTranche = destinationTranche;
        } else {
            destTranche = _tranche;
        }
    }

    function _sendTranche(
        address _from,
        address _to,
        uint256 _amount,
        bytes32 _tranche,
        bytes _data,
        bytes _operatorData
        )
        internal
        returns (byte, bytes32)
    {
        bytes32 destTranche = _tranche;
        if (testCase == TEST_SEND_DIFFERENT_TRANCHE) {
            destTranche = destinationTranche;
        }

        _ensureTrench(_from, _tranche);
        _ensureTrench(_to, destTranche);

        if (tranches[_from][trancheToIndex[_from][_tranche] - 1].amount < _amount) {
            return (0x00, bytes32(""));
        }

        // Checking the overflow condition in addition TODO: Create a library for that similar to SafeMath
        if (tranches[_to][trancheToIndex[_to][destTranche] - 1].amount > tranches[_to][trancheToIndex[_to][destTranche] - 1].amount + _amount) {
            return (0x10, bytes32(""));
        }

        tranches[_from][trancheToIndex[_from][_tranche] - 1].amount = tranches[_from][trancheToIndex[_from][_tranche] - 1].amount - _amount;
        balances[_from] = balances[_from] - _amount;
        tranches[_to][trancheToIndex[_to][destTranche] - 1].amount = tranches[_to][trancheToIndex[_to][destTranche] - 1].amount + _amount;
        balances[_to] = balances[_to] + _amount;

        return doTestCase(destTranche);
    }

    function doTestCase(bytes32 destTranche)
        internal
        view
        returns (byte, bytes32)
    {
        if (testCase == TEST_NOTHING) {
            return (0x01, destTranche);
        } else if (testCase == TEST_SEND_REQUIRE_FAIL) {
            require(false, "TRANSFER_FAILURE");
            return (0x01, destTranche);
        } else if (testCase == TEST_SEND_RETURN_FALSE) {
            return (0x00, destTranche);
        }
        return (0x01, destTranche);
    }

    function setTestCase(
        uint8 _testCase
        )
        external
    {
        testCase = _testCase;
    }

    function setDestinationTranche(
        bytes32 _destTranche
        )
        external
    {
        destinationTranche = _destTranche;
    }

}
