# Two-Level Production Selection System

## Overview
This system allows designers and production teams to select which colour/size/BOM combinations will actually go to production, preventing unnecessary SKU and BOM creation.

## Workflow

### Step 1: Design Phase (Designer)
1. Create a new **Style**
2. Add colours (e.g., Red, Blue, Green)
3. Add sizes (e.g., S, M, L, XL)
4. Add BOM materials with quantities and specifications

### Step 2: Approval Phase

#### 2a. Marketing Approves Colours
1. Open the **Colours** table in the Style
2. For each colour:
   - Check **"Approved for Production"** if approved by Marketing
   - Leave unchecked if rejected
   
**Example:**
- Red: ✓ Approved
- Blue: ✓ Approved  
- Green: ✗ Rejected (not approved)

#### 2b. Sourcing/Supply Chain Verifies Materials
1. Open the **BOM Items** table
2. For each material:
   - Check **"Available in Market"** if it can be sourced
   - Uncheck if material is unavailable/out of stock
   
**Example:**
- Cotton Fabric: ✓ Available
- Button (Type A): ✓ Available
- Zipper (Brand X): ✗ Not Available (use alternative)
- Trim: ✓ Available

### Step 3: Production Selection Summary
The Matrix tab shows a **Production Readiness** panel with:
- **Colours for Production**: 2/3 (Red, Blue approved; Green excluded)
- **BOM Materials Available**: 3/4 (One zipper variant unavailable)
- **Possible SKUs**: 6 (2 approved colours × 3 sizes)

The matrix now shows:
- ✓ Green badges for approved colours
- ✗ Red badges for unapproved colours
- Only approved colour rows appear in the matrix

### Step 4: Generate SKUs
1. Click **"Generate All SKUs"** button
2. System automatically:
   - ✅ Creates SKUs only for approved colour × size combinations
   - ✅ Creates BOMs with only available materials
   - ⏭️ Skips unapproved colours entirely
   - ⏭️ Excludes unavailable materials from all BOMs

**Result:**
- **Generated**: 6 SKUs (2 colours × 3 sizes)
- **Each BOM**: Contains 3 materials (zipper excluded)
- **Total SKUs/BOMs**: Only what's actually needed for production

## Benefits

| Before | After |
|--------|-------|
| All 9 SKUs created (3×3) | Only 6 SKUs created (2×3) |
| All BOMs with 4 materials | BOMs with only 3 materials |
| BOM versioning chaos | Clean, focused versions |
| Rejected colours still take resources | No wasted resources |
| Unavailable materials in BOMs | Clean BOMs ready for production |

## Use Cases

### Scenario 1: Design Rejected by Marketing
- Created: Red, Blue, Green designs
- Approved: Only Red and Blue
- **Result**: Only Red and Blue SKUs generated; Green never created

### Scenario 2: Material Shortage
- Planned 4 fabric types for all SKUs
- Only 3 available in market
- **Result**: All BOMs generated with only the 3 available fabrics

### Scenario 3: Mixed Approvals
- 4 colours designed, 3 approved
- 5 materials planned, 4 available
- **Result**: 
  - Only 3 colours in matrix
  - Only approved colour SKUs created
  - All BOMs use only 4 available materials
  - No version conflicts from unapproved variants

## Technical Details

### Fields Added

**Style Colour (istable)**
- `approved_for_production` (Check): Default 0
  - 0 = Not approved (excluded from SKU generation)
  - 1 = Approved (will generate SKUs)

**Style BOM Item (istable)**
- `available_in_market` (Check): Default 1
  - 0 = Not available (excluded from BOMs)
  - 1 = Available (included in BOMs)

**Style Matrix Item (istable)**
- `production_for_sku` (Check): Default 1
  - Manual override for legacy flexibility

### Python Methods

**`sync_matrix_rows()`**
- Only creates matrix items for colours where `approved_for_production = 1`
- Ignores unapproved colours entirely

**`_create_bom_for_item()`**
- Filters BOM items: only includes where `available_in_market = 1`
- Throws error if no materials available

**`generate_sku()`**
- Respects production selection
- Creates BOMs with available materials only

### UI Indicators

**Matrix Tab:**
- ✓ (Green) = Colour approved for production
- ✗ (Red) = Colour not approved

**Production Readiness Card:**
- Shows approved colours count
- Shows available materials count
- Shows total possible SKUs

## Troubleshooting

### "No available materials found for BOM"
- **Cause**: All BOM items have `available_in_market = 0`
- **Fix**: Mark at least one material as available in the BOM Items table

### Unapproved colour still appears in matrix
- **Cause**: `approved_for_production = 0` but row already existed
- **Fix**: Save the Style to re-sync the matrix

### BOM created with fewer materials than expected
- **Cause**: Some materials have `available_in_market = 0`
- **Fix**: This is intentional! Check the Production Readiness panel to see which materials were excluded

## See Also
- [Style Workflow](./STYLE_WORKFLOW.md)
- [BOM Management](./BOM_MANAGEMENT.md)
- [SKU Generation](./SKU_GENERATION.md)
