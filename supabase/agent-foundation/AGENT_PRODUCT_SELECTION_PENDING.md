# Pending agent-only product block selection — NOT APPLIED

The owner selected **17 products to block for sales agents only**, not for
QuickStock's owner account or customer portal. These selections are held for
the eventual explicitly approved rollout; they are NOT currently written to
Supabase. Do not flip `products.is_active`, delete product rows, or change
the existing manager order/sale workflows.

| Original item # | Product UUID | Agent-only desired status |
|---:|---|---|
| 1 | `7f2637f5-e4d2-4793-b6d7-0212e88e88f9` | blocked |
| 2 | `5468e634-0ec8-4e64-bd83-eb0cf41ebf72` | blocked |
| 4 | `d566c000-b18e-41b5-8181-d1fe37aa5272` | blocked |
| 12 | `43fe6035-cdc9-4479-b26a-447c5fbb13f2` | blocked |
| 13 | `28869bf9-09ec-4e67-b8a0-9f31a63e9a84` | blocked |
| 14 | `a6ee0632-0c80-43c9-9444-46ad8334294f` | blocked |
| 15 | `7a673457-c482-4000-a17d-a1b6bcba6d95` | blocked |
| 16 | `08ace447-407f-4ab6-8ab1-c854515f5a02` | blocked |
| 17 | `db51aa77-0ee6-4a22-aefd-db09e6f1a3f3` | blocked |
| 19 | `aac894db-cbff-4cde-90de-b76f6a95a3c1` | blocked |
| 23 | `a62f877f-3192-48b3-85be-305ca88bd1d5` | blocked |
| 24 | `4d80c159-579a-4504-8033-24688fa4f53d` | blocked |
| 30 | `54a423aa-7836-4db7-b266-54a0ee633093` | blocked |
| 34 | `8457a943-482e-40de-816e-3a939971340d` | blocked |
| 35 | `5ef50792-dc49-4d86-904c-3b842338faea` | blocked |
| 36 | `ec881702-bddb-4e8f-aa50-429e42889778` | blocked |
| 38 | `3694ba0a-a874-44ed-bcbe-a09ac6bde747` | blocked |

**Item #37**: `1f5302ee-2825-48ce-b5c2-ee6de2bd13ea`
(R25 aluminium tray; SKU 913) must be **agent-unblocked**.
Requested purchase price is **₪5.50 net**, current sale price **₪8.3898 net**.
This catalogue price change is **pending explicit authorization**, and
no production update has been executed.

The remaining **21 items are chosen unblocked for agents**; their owner-
provided purchase and sale price updates, including item #3, are pending
separate verified catalog changes with permission.

When the owner later approves production release, verify product UUID,
business owner, SKU and current product identity again before applying
agent-only block rows. A blocked product remains visible and usable to
the owner and the customer portal under the existing QuickStock rules.

The stage `19_agent_only_product_blocks_NOT_APPLIED.sql` creates the agent-
only table and strictly manager-scoped toggle RPC. Agents may not write it,
and all new agent order and margin-exception paths use the trusted server
margin gate. The management UI enables later release of any blocked item.
