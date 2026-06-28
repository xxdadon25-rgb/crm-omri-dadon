ALTER TABLE supplier_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated insert" ON supplier_deliveries
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated select" ON supplier_deliveries
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated update" ON supplier_deliveries
FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated delete" ON supplier_deliveries
FOR DELETE TO authenticated USING (true);
