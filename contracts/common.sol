// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
