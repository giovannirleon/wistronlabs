import useApi from "../hooks/useApi";

export function useSystemsFetch() {
  const { getSystems } = useApi();

  /**
   * Fetch systems with server-side pagination/sort/search
   * @param {Object} options { page, page_size, sort_by, sort_order, search }
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

    // search is optional — you can implement it as a filter on `service_tag` or `issue`
    if (search) {
      params.service_tag = search;
      // or: params.issue = search;
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
