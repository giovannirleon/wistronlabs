function buildWhereClause(filterGroup, params, tableAliases = {}) {
  const { op = "AND", conditions = [] } = filterGroup;

  const sqlConditions = conditions.map((cond) => {
    if (cond.conditions) {
      // nested group
      return `(${buildWhereClause(cond, params, tableAliases)})`;
    }

    const { field, op: fieldOp = "=", values = [], table = null } = cond;

    const column = tableAliases[field] || (table || "") + field;

    if (["IN", "NOT IN"].includes(fieldOp.toUpperCase())) {
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${column} ${fieldOp} (${placeholders.join(", ")})`;
    }

    const orClauses = values.map((v) => {
      params.push(fieldOp.toUpperCase() === "ILIKE" ? `%${v}%` : v);
      return `${column} ${fieldOp} $${params.length}`;
    });

    return `(${orClauses.join(" OR ")})`;
  });

  return sqlConditions.join(` ${op} `);
}
module.exports = { buildWhereClause };
