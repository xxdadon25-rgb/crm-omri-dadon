import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    console.log('[getQuotePDFLink] Request received');

    const base44 = createClientFromRequest(req);
    console.log('[getQuotePDFLink] Base44 client created');

    const user = await base44.auth.me();
    console.log('[getQuotePDFLink] User auth:', user?.id || 'unauthorized');

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { quoteId } = body;
    console.log('[getQuotePDFLink] Payload received - quoteId:', quoteId);

    if (!quoteId) {
      return Response.json({ error: 'Missing quoteId' }, { status: 400 });
    }

    console.log('[getQuotePDFLink] Fetching quote from database...');
    const quote = await base44.entities.Quote.get(quoteId);
    
    if (!quote) {
      return Response.json({ error: 'Quote not found' }, { status: 404 });
    }
    console.log('[getQuotePDFLink] Quote fetched:', quote.quote_number);

    console.log('[getQuotePDFLink] Fetching business settings...');
    const businessSettingsRecords = await base44.entities.BusinessSettings.list();
    const businessSettings = businessSettingsRecords[0] || {};
    console.log('[getQuotePDFLink] Business settings loaded');

    // Generate stable PDF preview URL (quote ID based, not temporary)
    const pdfUrl = `/quote-pdf/${quoteId}`;
    
    console.log('[getQuotePDFLink] PDF preview URL generated:', pdfUrl);
    return Response.json({
      success: true,
      file_url: pdfUrl,
    });
  } catch (error) {
    console.error('[getQuotePDFLink] Error:', error.message);
    console.error('[getQuotePDFLink] Stack:', error.stack);

    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
});