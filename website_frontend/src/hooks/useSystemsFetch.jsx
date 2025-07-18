import useApi from "../hooks/useApi";
import { buildLeaf, buildGroup } from "../utils/filter.js";

/**
 * Custom hook to fetch systems with advanced filters.
 */
export function useSystemsFetch() {
  const { getSystems } = useApi();

  /**
   * Fetch systems with server-side pagination/sort/search
   * @param {Object} options
   * @param {number} [options.page]
   * @param {number} [options.page_size]
   * @param {string} [options.sort_by]
   * @param {string} [options.sort_order]
   * @param {string} [options.search] - optional search string
   * @returns {Promise<{data: [], total_count: number, page: number, page_size: number}>}
   */
  const fetchSystems = async (options = {}) => {
    const {
      page = 1,
      page_size = 50,
      sort_by = "service_tag",
      sort_order = "asc",
      search,
    } = options;

    const params = {
      page,
      page_size,
      sort_by,
      sort_order,
    };
    console.log(search);
    if (search) {
      const orGroup = buildGroup("OR", [
        buildLeaf("location", [search], "ILIKE"),
        buildLeaf("service_tag", [search], "ILIKE"),
        buildLeaf("issue", [search], "ILIKE"),
      ]);

      params.filters = JSON.stringify({ conditions: [orGroup] });
    }

    const response = await getSystems(params);

    return {
      data: response.data,
      total_count: response.total_count,
      page: response.page,
      page_size: response.page_size,
    };
  };

  return fetchSystems;
}
