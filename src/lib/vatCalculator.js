/**
 * VAT Calculator — NET-FIRST pricing model.
 *
 * All stored prices are BEFORE VAT (net).
 * VAT is added only in document summaries.
 *
 * This file is kept for backward compatibility.
 * New code should use lib/vatLogic.js directly.
 */

export { calculateDocumentTotals, calculateLineTotal } from './vatLogic.js';