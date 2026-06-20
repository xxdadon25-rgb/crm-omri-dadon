import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    
    // Extract data from automation event or direct call
    const data = payload.data || payload;
    const event = payload.event;
    const order_id = event?.entity_id || data.id;
    const order_number = data.order_number;
    const status = data.status;
    const items = data.items;
    const inventory_processed = data.inventory_processed;

    const deductStatuses = ["אושר", "בהכנה", "הושלם"];
    const restoreStatuses = ["בוטל"];

    // Deduct inventory when order is confirmed
    if (deductStatuses.includes(status) && !inventory_processed) {
      for (const item of (items || [])) {
        if (item.product_id && item.quantity) {
          const product = await base44.asServiceRole.entities.Product.filter({ id: item.product_id }, null, 1).then(r => r[0]);
          
          if (product) {
            const newQuantity = Math.max(0, (product.quantity || 0) - item.quantity);
            await base44.asServiceRole.entities.Product.update(item.product_id, { quantity: newQuantity });

            // Log movement
            await base44.asServiceRole.entities.InventoryMovement.create({
              product_id: item.product_id,
              product_name: item.name,
              product_sku: item.sku,
              movement_type: "יציאה",
              quantity: item.quantity,
              quantity_before: product.quantity || 0,
              quantity_after: newQuantity,
              reference_type: "הזמנה",
              reference_id: order_id,
              reference_number: String(order_number),
              notes: `הזמנה #${order_number}`,
              performed_by: "מערכת"
            });
          }
        }
      }
      
      // Mark as processed
      await base44.asServiceRole.entities.Order.update(order_id, { inventory_processed: true });
    }

    // Restore inventory when order is cancelled
    if (restoreStatuses.includes(status) && inventory_processed) {
      for (const item of (items || [])) {
        if (item.product_id && item.quantity) {
          const product = await base44.asServiceRole.entities.Product.filter({ id: item.product_id }, null, 1).then(r => r[0]);
          
          if (product) {
            const newQuantity = (product.quantity || 0) + item.quantity;
            await base44.asServiceRole.entities.Product.update(item.product_id, { quantity: newQuantity });

            // Log movement
            await base44.asServiceRole.entities.InventoryMovement.create({
              product_id: item.product_id,
              product_name: item.name,
              product_sku: item.sku,
              movement_type: "החזרה",
              quantity: item.quantity,
              quantity_before: product.quantity || 0,
              quantity_after: newQuantity,
              reference_type: "הזמנה",
              reference_id: order_id,
              reference_number: String(order_number),
              notes: `ביטול הזמנה #${order_number}`,
              performed_by: "מערכת"
            });
          }
        }
      }
      
      // Mark as not processed
      await base44.asServiceRole.entities.Order.update(order_id, { inventory_processed: false });
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});