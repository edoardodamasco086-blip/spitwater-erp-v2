const { poolConnect, pool, sql } = require('./config/db');

async function test() {
  await poolConnect;
  try {
    const r = await pool.request()
      .input('product_id', sql.Int, 1)
      .input('org_id', sql.Int, 1)
      .query(`
        SELECT 
          a.id, a.association_type_id, a.from_product_id, a.to_product_id, a.sort_order, a.notes, a.created_at,
          t.type_key, t.label AS type_label, t.is_bidirectional, t.icon AS type_icon, t.colour AS type_colour,
          p.part_number AS to_part_number, p.name AS to_name,
          'outgoing' AS direction
        FROM product_associations a
        INNER JOIN product_association_types t ON t.id = a.association_type_id
        INNER JOIN products p ON p.id = a.to_product_id
        WHERE a.from_product_id = @product_id
          AND a.org_id = @org_id
          AND a.is_active = 1

        UNION ALL

        SELECT 
          a.id, a.association_type_id, a.from_product_id, a.to_product_id, a.sort_order, a.notes, a.created_at,
          t.type_key, t.reverse_label AS type_label, t.is_bidirectional, t.icon AS type_icon, t.colour AS type_colour,
          p.part_number AS to_part_number, p.name AS to_name,
          'incoming' AS direction
        FROM product_associations a
        INNER JOIN product_association_types t ON t.id = a.association_type_id
        INNER JOIN products p ON p.id = a.from_product_id
        WHERE a.to_product_id = @product_id
          AND a.org_id = @org_id
          AND a.is_active = 1
          AND t.is_bidirectional = 1

        ORDER BY type_label ASC, sort_order ASC, to_name ASC
      `);
    console.log(r.recordset);
  } catch (e) {
    console.error('SQL Error:', e);
  }
  process.exit(0);
}

test();
