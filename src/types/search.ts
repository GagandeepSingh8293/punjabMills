export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface SearchResultGroup {
  items: SearchResultItem[];
  total: number;
}

export interface GlobalSearchResponse {
  challans: SearchResultGroup;
  customers: SearchResultGroup;
}