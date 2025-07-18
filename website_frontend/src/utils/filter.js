/**
 * @typedef {Object} FilterLeaf
 * @property {string} field
 * @property {(string | number | null)[]} values
 * @property {"=" | "IN" | "ILIKE" | "LIKE" | ">" | "<" | ">=" | "<=" | "<>" | "NOT IN" | "IS NULL" | "IS NOT NULL"} [op]
 */

/**
 * @typedef {Object} FilterGroup
 * @property {"AND" | "OR"} op
 * @property {Filter[]} conditions
 */

/**
 * @typedef {FilterLeaf | FilterGroup} Filter
 */

/**
 * Builds a leaf filter condition.
 * @param {string} field
 * @param {(string | number | null)[]} values
 * @param {FilterLeaf['op']} [op]
 * @returns {FilterLeaf}
 */
function buildLeaf(field, values, op) {
  return { field, values, op };
}

/**
 * Builds a group of filters combined with AND or OR.
 * @param {"AND" | "OR"} op
 * @param {Filter[]} conditions
 * @returns {FilterGroup}
 */
function buildGroup(op, conditions) {
  return { op, conditions };
}

export { buildLeaf, buildGroup };
