// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract BasicTarget {
    uint256 public immutable magic = uint256(keccak256(abi.encode(block.prevrandao, block.timestamp)));

    function run(string calldata, uint256) external pure {}

    function checkMagic(uint256 value) external view {
        require(value == magic, "wrong magic");
    }

    function checkTimestamp(uint256 timestamp) external view {
        require(block.timestamp >= timestamp, "too early");
    }
}

contract DemoERC20 is ERC20, ERC20Permit {
    constructor() ERC20("Demo Token", "DEMO") ERC20Permit("Demo Token") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
