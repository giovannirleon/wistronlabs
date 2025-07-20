import { formatDateHumanReadable } from "../utils/date_format.js";
import useApi from "./useApi";

/**
 * Custom hook to fetch system location history.
 */
export function useHistoryFetch() {
  const { getHistory } = useApi();

  /**
   * Fetch system location history with filters, pagination, sorting.
   * @param {Object} options
   * @param {number} [options.page] - Page number (default 1)
   * @param {number} [options.page_size] - Page size (default 50)
   * @param {string} [options.sort_by] - Field to sort by (default 'changed_at')
   * @param {string} [options.sort_order] - 'asc' or 'desc' (default 'desc')
   * @param {string} [options.search] - Service tag search string
   * @param {boolean} [options.all] - If true, disables pagination
   * @param {Object} [options.filters] - Advanced filter object (AND/OR tree)
   * @returns {Promise<{data: [], total_count?: number, page?: number, page_size?: number}>}
   */
  const fetchHistory = async (options = {}) => {
    const {
      page = 1,
      page_size = 50,
      sort_by = "changed_at",
      sort_order = "desc",
      search,
      all = false,
      filters,
    } = options;

    const params = {
      sort_by,
      sort_order,
    };

    if (!all) {
      params.page = page;
      params.page_size = page_size;
    } else {
      params.all = true;
    }

    // Advanced filters
    const conditions = [];

    if (filters?.conditions?.length) {
      conditions.push(...filters.conditions);

      if (search) {
        console.warn(
          "[useHistoryFetch] Both `filters` and `search` were provided. Only `filters` is used."
        );
      }
    } else if (search) {
      conditions.push({
        field: "service_tag",
        values: [search],
        op: "ILIKE",
      });
    }

    if (conditions.length > 0) {
      params.filters = JSON.stringify({ op: "AND", conditions });
    }

    const response = await getHistory(params);

    // handle `all=true` case where backend returns array
    const rows = Array.isArray(response) ? response : response.data;

    const formatted = rows.map((h) => ({
      ...h,
      // changed_at: formatDateHumanReadable(h.changed_at),
    }));

    if (all) {
      return { data: formatted };
    }

    return {
      data: formatted,
      total_count: response.total_count,
      page: response.page,
      page_size: response.page_size,
    };
  };

  return fetchHistory;
}
