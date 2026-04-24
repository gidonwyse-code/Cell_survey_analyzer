import { useQuery } from '@tanstack/react-query'
import type { Metadata } from '../types'

export function useMetadata() {
  return useQuery<Metadata>({
    queryKey: ['metadata'],
    queryFn: () => fetch('/api/od/metadata').then((r) => r.json()),
    staleTime: Infinity,
  })
}
