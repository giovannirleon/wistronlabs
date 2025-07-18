import useApi from "../hooks/useApi";
import { buildLeaf, buildGroup } from "../utils/filter.js";
import { formatDateHumanReadable } from "../utils/date_format.js";

/**
 * Custom hook to fetch systems with advanced filters.
 */
export function useSystemsFetch() {
  const { getSystems, getLocations } = useApi();

  /**
   * Fetch systems with server-side pagination/sort/search/active-inactive filter
   * @param {Object} options
   * @param {number} [options.page]
   * @param {number} [options.page_size]
   * @param {string} [options.sort_by]
   * @param {string} [options.sort_order]
   * @param {string} [options.search]
   * @param {boolean} [options.active] - include active
   * @param {boolean} [options.inactive] - include inactive
   * @returns {Promise<{data: [], total_count: number, page: number, page_size: number}>}
   */
  const fetchSystems = async (options = {}) => {
    const {
      page = 1,
      page_size = 50,
      sort_by = "service_tag",
      sort_order = "asc",
      search,
      active = true,
      inactive = true,
    } = options;

    const params = {
      page,
      page_size,
      sort_by,
      sort_order,
    };

    const conditions = [];

    // Add search
    if (search) {
      const orGroup = buildGroup("OR", [
        buildLeaf("location", [search], "ILIKE"),
        buildLeaf("service_tag", [search], "ILIKE"),
        buildLeaf("issue", [search], "ILIKE"),
      ]);
      conditions.push(orGroup);
    }

    // Add active/inactive
    const inactiveLocations = [6, 7, 8, 9];

    if (active && !inactive) {
      conditions.push(buildLeaf("location_id", inactiveLocations, "NOT IN"));
    } else if (!active && inactive) {
      conditions.push(buildLeaf("location_id", inactiveLocations, "IN"));
    } else if (!active && !inactive) {
      // Neither checked → show nothing
      conditions.push(buildLeaf("location_id", [-1], "IN"));
    }
    // if both active && inactive → show all (no filter)

    if (conditions.length > 0) {
      params.filters = JSON.stringify({ op: "AND", conditions });
    }

    // Call backend
    const response = await getSystems(params);

    // Format dates
    const formattedData = response.data.map((d) => ({
      ...d,
      date_created: formatDateHumanReadable(d.date_created),
      date_modified: formatDateHumanReadable(d.date_modified),
      service_tag_title: "Service Tag",
      issue_title: "Issue",
      location_title: "Location",
      date_created_title: "Date Created",
      date_modified_title: "Date Modified",
      link: d.service_tag,
    }));

    return {
      data: formattedData,
      total_count: response.total_count,
      page: response.page,
      page_size: response.page_size,
    };
  };

  return fetchSystems;
}
