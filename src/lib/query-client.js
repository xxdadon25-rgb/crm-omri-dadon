import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 30 * 1000, // 30 seconds — data is fresh for 30s, then refetched on next mount
			gcTime: 5 * 60 * 1000, // 5 minutes — don't keep stale data in memory forever
			refetchOnMount: true,  // always refetch when navigating to a page
		},
	},
});