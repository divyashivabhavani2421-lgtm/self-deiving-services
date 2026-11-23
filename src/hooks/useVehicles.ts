import { useCallback, useEffect, useState } from 'react';
import { fetchVehicles } from '../services/vehiclesService';
import { Vehicle } from '../types/vehicle';

interface UseVehiclesOptions {
  includeInactive?: boolean;
}

interface UseVehiclesState {
  vehicles: Vehicle[];
  detectedColumns: string[];
  loading: boolean;
  error: string | null;
  isConfigMissing: boolean;
  reload: () => void;
}

export function useVehicles(options?: UseVehiclesOptions): UseVehiclesState {
  const includeInactive = options?.includeInactive ?? false;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigMissing, setIsConfigMissing] = useState<boolean>(false);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await fetchVehicles({ includeInactive });
        if (!active) return;
        setVehicles(result.vehicles);
        setDetectedColumns(result.detectedColumns);
        setError(result.error);
        setIsConfigMissing(result.isConfigMissing);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Unexpected error while loading vehicles.';
        setVehicles([]);
        setDetectedColumns([]);
        setError(message);
        setIsConfigMissing(false);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [includeInactive, reloadToken]);

  return {
    vehicles,
    detectedColumns,
    loading,
    error,
    isConfigMissing,
    reload,
  };
}
