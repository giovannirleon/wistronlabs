export function useHistoryFetch() {
  const { getHistory } = useApi();

  const fetchHistory = async (options = {}) => {
    const {
      page = 1,
      page_size = 50,
      sort_by = "changed_at",
      sort_order = "desc",
      search,
    } = options;

    const params = {
      page,
      page_size,
      sort_by,
      sort_order,
    };

    if (search) {
      params.service_tag = search;
    }

    const response = await getHistory(params);

    return {
      data: response.data,
      total_count: response.total_count,
      page: response.page,
      page_size: response.page_size,
    };
  };

  return fetchHistory;
}
