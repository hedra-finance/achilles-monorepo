// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IDiamondCut } from "./interfaces/IDiamondCut.sol";
import { LibDiamond } from "./libraries/LibDiamond.sol";

/// @title  HubLedger — EIP-2535 diamond proxy for the per-product hub ledger
/// @notice Ported from Nick Mudge's reference `Diamond` (https://eips.ethereum.org/assets/eip-2535/reference/Diamond.sol,
///         CC0-1.0). The proxy itself holds only the constructor cut and the fallback router; diamondCut,
///         loupe and ownership live in their own facets (DiamondCutFacet, DiamondLoupeFacet, OwnershipFacet).
///         Each facet has its own EIP-170 budget, so ledger features are added or removed per facet.
contract HubLedger {
    struct DiamondArgs {
        address owner;
        address init;
        bytes initCalldata;
    }

    constructor(IDiamondCut.FacetCut[] memory _diamondCut, DiamondArgs memory _args) payable {
        LibDiamond.setContractOwner(_args.owner);
        LibDiamond.diamondCut(_diamondCut, _args.init, _args.initCalldata);
    }

    // Selector lookup → delegatecall (identical to the reference implementation).
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        assembly { ds.slot := position }
        address facet = ds.facetAddressAndSelectorPosition[msg.sig].facetAddress;
        if (facet == address(0)) revert FunctionNotFound(msg.sig);
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

error FunctionNotFound(bytes4 _functionSelector);
