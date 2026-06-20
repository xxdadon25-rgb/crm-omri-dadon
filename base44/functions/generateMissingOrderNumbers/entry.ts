import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all orders and settings
    const [orders, settingsRecords] = await Promise.all([
      base44.asServiceRole.entities.Order.list(),
      base44.asServiceRole.entities.BusinessSettings.list()
    ]);

    const settings = settingsRecords[0] || { invoice_counter: 1000 };
    let counter = settings.invoice_counter || 1000;

    // Filter orders without order_number
    const ordersToUpdate = orders.filter(o => !o.order_number);

    if (ordersToUpdate.length === 0) {
      return Response.json({ message: 'No orders missing order_number', updated: 0 });
    }

    // Sort by created_date to maintain consistency
    ordersToUpdate.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

    // Generate and update order numbers
    const updatePromises = ordersToUpdate.map(order => {
      counter++;
      return base44.asServiceRole.entities.Order.update(order.id, { order_number: counter });
    });

    await Promise.all(updatePromises);

    // Update settings counter
    if (settings.id) {
      await base44.asServiceRole.entities.BusinessSettings.update(settings.id, { invoice_counter: counter });
    }

    return Response.json({ 
      message: `Successfully generated ${ordersToUpdate.length} order numbers`,
      updated: ordersToUpdate.length,
      nextNumber: counter + 1
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});