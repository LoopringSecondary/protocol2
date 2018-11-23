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

import "../iface/Errors.sol";
import "../lib/ERC1400.sol";

/**
 * @title SafeMath
 * @dev Math operations with safety checks that throw on error
 */
library SafeMath {
    /**
     * @dev Multiplies two numbers, throws on overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }
        uint256 c = a * b;
        assert(c / a == b);
        return c;
    }
    /**
     * @dev Integer division of two numbers, truncating the quotient.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        // assert(b > 0); // Solidity automatically throws when dividing by 0
        uint256 c = a / b;
        // assert(a == b * c + a % b); // There is no case in which this doesn't hold
        return c;
    }
    /**
     * @dev Subtracts two numbers, throws on overflow (i.e. if subtrahend is greater than minuend).
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        assert(b <= a);
        return a - b;
    }
    /**
     * @dev Adds two numbers, throws on overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        assert(c >= a);
        return c;
    }
}

/**
 * @title Reference implementation of partially-fungible tokens
 */
contract PartialFungibleToken is ERC1410 {
    using SafeMath for uint256;

    // Represents a fungible set of tokens.
    struct Tranche {
        uint256 amount;
        bytes32 tranche;
    }

    uint256 public totalSupply;

    string public name;

    string public symbol;

    // Mapping from investor to aggregated balance across all investor token sets
    mapping (address => uint256) balances;

    // Mapping from investor to their tranches
    mapping (address => Tranche[]) tranches;

    // Mapping from (investor, tranche) to index of corresponding tranche in tranches
    mapping (address => mapping (bytes32 => uint256)) trancheToIndex;

    // Mapping from (investor, tranche, operator) to approved status
    mapping (address => mapping (bytes32 => mapping (address => bool))) trancheApprovals;

    // Mapping from (investor, operator) to approved status (can be used against any tranches)
    mapping (address => mapping (address => bool)) approvals;

    /// @notice A descriptive name for tokens in this contract
    function name()
        external
        view
        returns (string)
    {
        return name;
    }

    /// @notice An abbreviated name for tokens in this contract
    function symbol()
        external
        view
        returns (string)
    {
        return symbol;
    }

    /// @notice Counts the sum of all tranche balances assigned to an owner
    /// @param _owner An address for whom to query the balance
    /// @return The number of tokens owned by `_owner`, possibly zero
    function balanceOf(address _owner) public view returns (uint256) {
        return balances[_owner];
    }

    /// @notice Counts the balance associated with a specific tranche assigned to an owner
    /// @param _tranche The tranche for which to query the balance
    /// @param _owner An address for whom to query the balance
    /// @return The number of tokens owned by `_owner` with the metadata associated with `_tranche`, possibly zero
    function balanceOfTranche(bytes32 _tranche, address _owner) public view returns (uint256) {
        if (trancheToIndex[_owner][_tranche] == 0) {
            return 0;
        }
        return tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount;
    }

    function totalSupply()
        external
        view
        returns (uint256)
    {
        return totalSupply;
    }

    /// @notice Transfers the ownership of tokens from a specified tranche from one address to another address
    /// @param _tranche The tranche from which to transfer tokens
    /// @param _to The address to which to transfer tokens to
    /// @param _amount The amount of tokens to transfer from `_tranche`
    /// @param _data Additional data attached to the transfer of tokens
    /// @return A reason code related to the success of the send operation
    /// @return The tranche to which the transferred tokens were allocated for the _to address
    function sendTranche(bytes32 _tranche, address _to, uint256 _amount, bytes _data) external returns (byte, bytes32) {
        (byte reason, bytes32 newTranche) = _sendTranche(msg.sender, _to, _amount, _tranche, _data, "");
        emit SentTranche(
            address(0),
            msg.sender,
            _to,
            _tranche,
            newTranche,
            _amount,
            _data,
            ""
        );
        return (reason, newTranche);
    }

    function _ensureTrench(
        address _owner,
        bytes32 _tranche
        )
        internal
    {
        if (trancheToIndex[_owner][_tranche] == 0) {
            Tranche memory tranche;
            tranche.amount = 0;
            tranche.tranche = _tranche;
            tranches[_owner].push(tranche);
            trancheToIndex[_owner][_tranche] = tranches[_owner].length;
        }
    }

    function _sendTranche(address _from, address _to, uint256 _amount, bytes32 _tranche, bytes _data, bytes /*_operatorData*/)
        internal
        returns (byte, bytes32)
    {
        bytes32 destTranche = _getDestinationTranche(_tranche, _data);

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

        // TODO: If transferring to a registered contract, call its callback function

        return (0x01, destTranche);
    }

    /// @notice Transfers the ownership of tokens from a specified tranche from one address to another address
    /// @param _from The address from which to transfer tokens from
    /// @param _to The address to which to transfer tokens to
    /// @param _tranche The tranche from which to transfer tokens
    /// @param _amount The amount of tokens to transfer from `_tranche`
    /// @param _data Additional data attached to the transfer of tokens
    /// @param _operatorData Additional data attached to the transfer of tokens by the operator
    /// @return A reason code related to the success of the send operation
    /// @return The tranche to which the transferred tokens were allocated for the _to address
    function operatorSendTranche(bytes32 _tranche, address _from, address _to, uint256 _amount, bytes _data, bytes _operatorData)
        external
        returns (byte, bytes32)
    {
        // Check operator is approved
        if ((!trancheApprovals[_from][_tranche][msg.sender]) && (!approvals[_from][msg.sender])) {
            return (0x20, bytes32(""));
        }
        (byte reason, bytes32 newTranche) = _sendTranche(_from, _to, _amount, _tranche, _data, _operatorData);
        emit SentTranche(
            msg.sender,
            _from,
            _to,
            _tranche,
            newTranche,
            _amount,
            _data,
            _operatorData
        );
        return (reason, newTranche);
    }

    /// @notice Allows enumeration over an individual owners tranches
    /// @param _owner An address over which to enumerate tranches
    /// @param _index The index of the tranche
    /// @return The tranche key corresponding to `_index`
    function trancheByIndex(address _owner, uint256 _index) external view returns (bytes32) {
        return tranches[_owner][_index].tranche;
    }

    /// @notice Enables caller to determine the count of tranches owned by an address
    /// @param _owner An address over which to enumerate tranches
    /// @return The number of tranches owned by an `_owner`
    function tranchesOf(address _owner) external view returns (uint256) {
        return tranches[_owner].length;
    }

    /// @notice Defines a list of operators which can operate over all addresses and tranches
    /// @return The list of default operators
    function defaultOperators() public view returns (address[]) {
        // No default operators
        return new address[](0);
    }

    /// @notice Defines a list of operators which can operate over all addresses for the specified tranche
    /// @return The list of default operators for `_tranche`
    function defaultOperatorsTranche(bytes32/* _tranche*/) public view returns (address[]) {
        // No default operators
        return new address[](0);
    }


    /// @notice Authorises an operator for all tranches of `msg.sender`
    /// @param _operator An address which is being authorised
    function authorizeOperator(address _operator) public {
        approvals[msg.sender][_operator] = true;
        emit AuthorizedOperator(_operator, msg.sender);
    }

    /// @notice Authorises an operator for a given tranche of `msg.sender`
    /// @param _tranche The tranche to which the operator is authorised
    /// @param _operator An address which is being authorised
    function authorizeOperatorTranche(bytes32 _tranche, address _operator) public {
        trancheApprovals[msg.sender][_tranche][_operator] = true;
        emit AuthorizedOperatorTranche(_tranche, _operator, msg.sender);
    }

    /// @notice Revokes authorisation of an operator previously given for all tranches of `msg.sender`
    /// @param _operator An address which is being de-authorised
    function revokeOperator(address _operator) public {
        approvals[msg.sender][_operator] = false;
        emit RevokedOperator(_operator, msg.sender);
    }

    /// @notice Revokes authorisation of an operator previously given for a specified tranche of `msg.sender`
    /// @param _tranche The tranche to which the operator is de-authorised
    /// @param _operator An address which is being de-authorised
    function revokeOperatorTranche(bytes32 _tranche, address _operator) public {
        trancheApprovals[msg.sender][_tranche][_operator] = false;
        emit RevokedOperatorTranche(_tranche, _operator, msg.sender);
    }

    /// @notice Determines whether `_operator` is an operator for all tranches of `_owner`
    /// @param _operator The operator to check
    /// @param _owner The owner to check
    /// @return Whether the `_operator` is an operator for all tranches of `_owner`
    function isOperatorFor(address _operator, address _owner) public view returns (bool) {
        return approvals[_owner][_operator];
    }

    /// @notice Determines whether `_operator` is an operator for a specified tranche of `_owner`
    /// @param _tranche The tranche to check
    /// @param _operator The operator to check
    /// @param _owner The owner to check
    /// @return Whether the `_operator` is an operator for a specified tranche of `_owner`
    function isOperatorForTranche(bytes32 _tranche, address _operator, address _owner) public view returns (bool) {
        return approvals[_owner][_operator] || trancheApprovals[_owner][_tranche][_operator];
    }

    /// @notice Increases totalSupply and the corresponding amount of the specified owners tranche
    /// @param _tranche The tranche to allocate the increase in balance
    /// @param _owner The owner whose balance should be increased
    /// @param _amount The amount by which to increase the balance
    /// @param _data Additional data attached to the minting of tokens
    /// @return A reason code related to the success of the mint operation
    function mint(bytes32 _tranche, address _owner, uint256 _amount, bytes _data) public returns (byte reason) {
        // TODO: Apply the check for Authorization of Mint function

        _ensureTrench(_owner, _tranche);

        if (tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount + _amount <
            tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount) {
            return (0x10);
        }
        if (balances[_owner] + _amount < balances[_owner]) {
            return (0x10);
        }
        if (totalSupply + _amount < totalSupply) {
            return (0x10);
        }
        tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount = tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount + _amount;
        balances[_owner] = balances[_owner] + _amount;
        totalSupply = totalSupply + _amount;
        emit Minted(_owner, _tranche, _amount, _data);
        emit SentTranche(
            msg.sender,
            address(0),
            _owner,
            bytes32(""),
            _tranche,
            _amount,
            _data,
            ""
        );
        return 0x01;
    }

    /// @notice Decreases totalSupply and the corresponding amount of the specified owners tranche
    /// @param _tranche The tranche to allocate the decrease in balance
    /// @param _owner The owner whose balance should be decreased
    /// @param _amount The amount by which to decrease the balance
    /// @param _data Additional data attached to the burning of tokens
    /// @return A reason code related to the success of the burn operation
    function burn(bytes32 _tranche, address _owner, uint256 _amount, bytes _data) public returns (byte reason) {
        // TODO: Apply the check for Authorization of burn function

        _ensureTrench(_owner, _tranche);

        if (tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount - _amount >
            tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount) {
            return (0x10);
        }
        if (balances[_owner] - _amount > balances[_owner]) {
            return (0x10);
        }
        if (totalSupply - _amount > totalSupply) {
            return (0x10);
        }
        tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount = tranches[_owner][trancheToIndex[_owner][_tranche] - 1].amount - _amount;
        balances[_owner] = balances[_owner] - _amount;
        totalSupply = totalSupply - _amount;
        emit Burnt(_owner, _tranche, _amount, _data);
        emit SentTranche(
            msg.sender,
            _owner,
            address(0),
            _tranche,
            bytes32(""),
            _amount,
            _data,
            ""
        );
        return 0x01;
    }

    function _getDestinationTranche(
        bytes32 _tranche,
        bytes   _data
        )
        internal
        pure
        returns (bytes32)
    {
        // We interpret the last 32 bytes of the transfer data to be the destination tranche
        // when the transfer data starts with 1 zero byte followed by 32 bytes.
        // THIS IS NOT PART OF THE ERC1400 STANDARD!
        // EVERY TOKEN CAN INTERPRET THE TRANSFER DATA DIFFERENTLY!
        if (_data.length == 32 + 1) {
            uint8 dataType;
            assembly {
                dataType := mload(add(_data, 1))
            }
            if (dataType == uint8(0)) {
                bytes32 destTranche;
                assembly {
                    destTranche := mload(add(_data, 33))
                }
                return destTranche;
            } else {
                return _tranche;
            }
        } else {
            return _tranche;
        }
    }
}

contract ERC1400Token is PartialFungibleToken, ERC1400, Errors {

    // Document Management
    function getDocument(
        bytes32/* _name*/
        )
        external
        view
        returns (string document, bytes32 hash)
    {
        document = "Document";
        hash = 0x0;
    }

    function setDocument(
        bytes32/* _name*/,
        string/* _uri*/,
        bytes32/* _documentHash*/
        )
        external
    {
        return;
    }

    // Controller Operation
    function isControllable()
        external
        view
        returns (bool)
    {
        return true;
    }

    // Token Issuance
    function isIssuable()
        external
        view
        returns (bool)
    {
        return false;
    }

    function issueByTranche(
        bytes32/* _tranche*/,
        address/* _tokenHolder*/,
        uint256/* _amount*/,
        bytes/* _data*/
        )
        external
    {
        return;
    }

    // Token Redemption
    function redeemByTranche(
        bytes32/* _tranche*/,
        uint256/* _amount*/,
        bytes/* _data*/
        )
        external
    {
        return;
    }

    function operatorRedeemByTranche(
        bytes32/* _tranche*/,
        address/* _tokenHolder*/,
        uint256/* _amount*/,
        bytes/* _operatorData*/
        )
        external
    {
        return;
    }

    // Transfer Validity
    function canSend(
        address _from,
        address/* _to*/,
        bytes32 _tranche,
        uint256 _amount,
        bytes _data
        )
        external
        view
        returns (byte code, bytes32 description, bytes32 destTranche)
    {
        destTranche = _getDestinationTranche(_tranche, _data);

        // Always allow the send when the balance is valid
        uint balance = balanceOfTranche(_tranche, _from);
        if (balance < _amount) {
            code = 0x00;
            description = 0x0;
        } else {
            code = 0xA0;
            description = 0x0;
        }
    }

    constructor(
        string  _name,
        string  _symbol,
        uint    _totalSupply,
        address _firstHolder
        )
        public
    {
        require(_totalSupply > 0, "INVALID_VALUE");
        require(_firstHolder != 0x0, "ZERO_ADDRESS");
        checkSymbolAndName(_symbol,_name);

        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;

        balances[_firstHolder] = totalSupply;
    }

     // Make sure symbol has 3-8 chars in [A-Za-z._] and name has up to 128 chars.
    function checkSymbolAndName(
        string memory _symbol,
        string memory _name
        )
        internal
        pure
    {
        bytes memory s = bytes(_symbol);
        require(s.length >= 3 && s.length <= 8, "INVALID_SIZE");
        for (uint i = 0; i < s.length; i++) {
            // make sure symbol contains only [A-Za-z._]
            require(
                s[i] == 0x2E || (
                s[i] == 0x5F) || (
                s[i] >= 0x41 && s[i] <= 0x5A) || (
                s[i] >= 0x61 && s[i] <= 0x7A), "INVALID_VALUE");
        }
        bytes memory n = bytes(_name);
        require(n.length >= s.length && n.length <= 128, "INVALID_SIZE");
        for (uint i = 0; i < n.length; i++) {
            require(n[i] >= 0x20 && n[i] <= 0x7E, "INVALID_VALUE");
        }
    }

    function ()
        external
        payable
    {
        revert(UNSUPPORTED);
    }
}
