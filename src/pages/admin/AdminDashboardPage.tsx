import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Database,
  Edit3,
  Image as ImageIcon,
  IndianRupee,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { BUSINESS_CONFIG } from '../../config/businessConfig';
import { useAuth } from '../../context/AuthContext';
import { useVehicles } from '../../hooks/useVehicles';
import { deleteVehicle, updateVehicle } from '../../services/vehiclesService';
import { Vehicle } from '../../types/vehicle';
import { formatINR } from '../../utils/rentalUtils';
import { AdminBookingsManager } from '../../components/admin/AdminBookingsManager';
import { VehicleForm } from '../../components/admin/VehicleForm';
import { VehicleImagesManager } from '../../components/admin/VehicleImagesManager';
import { VehicleImage } from '../../components/VehicleImage';
import { VehicleErrorState } from '../../components/VehicleListStates';

type AdminSection =
  | 'overview'
  | 'bookings'
  | 'vehicles'
  | 'add'
  | 'edit'
  | 'images'
  | 'pricing'
  | 'settings';

const SIDEBAR_ITEMS: { id: AdminSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard },
  { id: 'bookings', label: 'Manage Bookings', icon: ClipboardList },
  { id: 'vehicles', label: 'Manage Vehicles', icon: CarFront },
  { id: 'add', label: 'Add Vehicle', icon: Plus },
  { id: 'images', label: 'Vehicle Images', icon: ImageIcon },
  { id: 'pricing', label: 'Rental Pricing', icon: IndianRupee },
  { id: 'settings', label: 'Business Settings', icon: Settings },
];

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user, profile, isAdmin, signOut } = useAuth();
  const { vehicles, detectedColumns, loading, error, isConfigMissing, reload } = useVehicles({
    includeInactive: true,
  });

  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [selectedImageVehicleId, setSelectedImageVehicleId] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [actionNotice, setActionNotice] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  // Inline pricing drafts keyed by vehicle ID (12h / 24h / deposit)
  const [pricingDrafts, setPricingDrafts] = useState<
    Record<string, { price12h: string; price24h: string; deposit: string }>
  >({});

  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => v.isActive).length;
    const inactive = vehicles.filter((v) => !v.isActive).length;
    const rates = vehicles
      .filter((v) => v.isActive && v.price24h !== null && v.price24h > 0)
      .map((v) => v.price24h as number);
    const starting24h = rates.length > 0 ? Math.min(...rates) : null;
    return { total, active, inactive, starting24h };
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vehicles.filter((car) => {
      if (statusFilter === 'active' && !car.isActive) return false;
      if (statusFilter === 'inactive' && car.isActive) return false;
      if (
        q &&
        !car.name.toLowerCase().includes(q) &&
        !car.make.toLowerCase().includes(q) &&
        !car.model.toLowerCase().includes(q) &&
        !car.registrationNumber.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [vehicles, searchQuery, statusFilter]);

  const handleToggleActive = async (car: Vehicle) => {
    setBusyVehicleId(car.id);
    setActionError('');
    setActionNotice('');
    try {
      const res = await updateVehicle(car.id, { isActive: !car.isActive }, detectedColumns);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      setActionNotice(
        `"${car.name}" is now ${!car.isActive ? 'Active (visible & bookable)' : 'Inactive (hidden from customers)'}.`
      );
      reload();
    } finally {
      setBusyVehicleId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyVehicleId(target.id);
    setActionError('');
    setActionNotice('');

    try {
      const res = await deleteVehicle(target.id, detectedColumns);
      if (!res.success) {
        setActionError(res.error || 'Could not delete vehicle.');
        setDeleteTarget(null);
        return;
      }
      setActionNotice(`Deleted "${target.name}" from the database.`);
      setDeleteTarget(null);
      reload();
    } finally {
      setBusyVehicleId(null);
    }
  };

  const getPricingDraft = (car: Vehicle) => {
    return (
      pricingDrafts[car.id] ?? {
        price12h: car.price12h !== null ? String(car.price12h) : '',
        price24h: car.price24h !== null ? String(car.price24h) : '',
        deposit: car.securityDeposit !== null ? String(car.securityDeposit) : '',
      }
    );
  };

  const handleSaveRowPricing = async (car: Vehicle) => {
    const draft = getPricingDraft(car);
    const p12 = draft.price12h.trim() ? Number(draft.price12h) : null;
    const p24 = draft.price24h.trim() ? Number(draft.price24h) : null;
    const deposit = draft.deposit.trim() ? Number(draft.deposit) : null;

    if (p12 === null || !Number.isFinite(p12) || p12 <= 0) {
      setActionError(`Please enter a valid 12h price for ${car.name}.`);
      return;
    }
    if (p24 === null || !Number.isFinite(p24) || p24 <= 0) {
      setActionError(`Please enter a valid 24h price for ${car.name}.`);
      return;
    }
    if (deposit !== null && (!Number.isFinite(deposit) || deposit < 0)) {
      setActionError(`Security deposit for ${car.name} must be a non-negative number.`);
      return;
    }

    setBusyVehicleId(car.id);
    setActionError('');
    setActionNotice('');

    try {
      const res = await updateVehicle(
        car.id,
        { price12h: p12, price24h: p24, securityDeposit: deposit },
        detectedColumns
      );
      if (res.error) {
        setActionError(res.error);
        return;
      }
      setActionNotice(`Updated 12h/24h rental pricing for "${car.name}".`);
      reload();
    } finally {
      setBusyVehicleId(null);
    }
  };

  const handleAdminLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const adminName = profile?.fullName || user?.email || 'Administrator';

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/70">
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        {/* Sidebar Navigation */}
        <aside className="border-b border-slate-200 bg-white lg:min-h-[calc(100vh-4rem)] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="p-4 sm:p-5">
            <p className="text-xs font-semibold text-[#1D4ED8]">Admin Workspace</p>
            <p className="mt-0.5 truncate font-display text-sm font-bold text-[#0B1F3A]">{adminName}</p>
          </div>

          <nav aria-label="Admin dashboard sections" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-6">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isCurrent =
                activeSection === item.id || (activeSection === 'edit' && item.id === 'vehicles');

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    setEditingVehicle(null);
                    setActionError('');
                    setActionNotice('');
                  }}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
                    isCurrent
                      ? 'bg-[#0B1F3A] text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1F3A]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          {/* Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="text-xs font-medium text-slate-500">
                Admin <span aria-hidden="true">/</span>{' '}
                <span className="text-[#0B1F3A]">
                  {activeSection === 'edit'
                    ? 'Edit Vehicle'
                    : SIDEBAR_ITEMS.find((i) => i.id === activeSection)?.label}
                </span>
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">
                {activeSection === 'edit'
                  ? `Edit ${editingVehicle?.name || 'Vehicle'}`
                  : SIDEBAR_ITEMS.find((i) => i.id === activeSection)?.label}
              </h1>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => reload()}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>

              {activeSection !== 'add' && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingVehicle(null);
                    setActiveSection('add');
                    setActionError('');
                    setActionNotice('');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Add Vehicle</span>
                </button>
              )}
            </div>
          </div>

          {/* Feedback Banners */}
          {actionNotice && (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-[#166534]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{actionNotice}</span>
            </div>
          )}

          {actionError && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}

          {error ? (
            <div className="mt-6">
              <VehicleErrorState error={error} isConfigMissing={isConfigMissing} onRetry={reload} />
            </div>
          ) : (
            <div className="mt-6">
              {/* 1. OVERVIEW */}
              {activeSection === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Total Vehicles</p>
                      <p className="mt-2 font-display text-3xl font-bold text-[#0B1F3A] tabular-nums">
                        {loading ? '—' : stats.total}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Active (Bookable)</p>
                      <p className="mt-2 font-display text-3xl font-bold text-[#15803D] tabular-nums">
                        {loading ? '—' : stats.active}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Inactive</p>
                      <p className="mt-2 font-display text-3xl font-bold text-slate-600 tabular-nums">
                        {loading ? '—' : stats.inactive}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Starting 24h Rate</p>
                      <p className="mt-2 font-display text-3xl font-bold text-[#1D4ED8] tabular-nums">
                        {loading ? '—' : stats.starting24h !== null ? formatINR(stats.starting24h) : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Quick Fleet Overview Table */}
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">Fleet Snapshot</h2>
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => setActiveSection('bookings')}
                          className="text-xs font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]"
                        >
                          Manage Bookings
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSection('vehicles')}
                          className="text-xs font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]"
                        >
                          Open Full Manager
                        </button>
                      </div>
                    </div>

                    {loading ? (
                      <div className="p-6 text-sm text-slate-500">Loading vehicles from Supabase...</div>
                    ) : vehicles.length === 0 ? (
                      <div className="p-8 text-center text-sm text-slate-600">
                        No vehicles found in your database. Click <strong>Add Vehicle</strong> to create one.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                            <tr>
                              <th className="px-5 py-3">Vehicle</th>
                              <th className="px-4 py-3">Specs</th>
                              <th className="px-4 py-3 text-right">12h Rate</th>
                              <th className="px-4 py-3 text-right">24h Rate</th>
                              <th className="px-4 py-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {vehicles.map((car) => (
                              <tr key={car.id} className="hover:bg-slate-50/70">
                                <td className="px-5 py-3.5 font-semibold text-[#0B1F3A]">{car.name}</td>
                                <td className="px-4 py-3.5 text-xs text-slate-600">
                                  {[car.fuelType, car.transmission, car.seats ? `${car.seats} Seats` : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                                </td>
                                <td className="px-4 py-3.5 text-right font-semibold text-[#0B1F3A] tabular-nums">
                                  {car.price12h !== null ? formatINR(car.price12h) : '—'}
                                </td>
                                <td className="px-4 py-3.5 text-right font-semibold text-[#0B1F3A] tabular-nums">
                                  {car.price24h !== null ? formatINR(car.price24h) : '—'}
                                </td>
                                <td className="px-4 py-3.5 text-xs font-medium">
                                  <span className={car.isActive ? 'text-[#15803D]' : 'text-slate-500'}>
                                    {car.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 2. MANAGE VEHICLES */}
              {activeSection === 'vehicles' && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 sm:max-w-xs">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search make, model, or reg no..."
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                        aria-label="Filter by active status"
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A]"
                      >
                        <option value="all">All Statuses</option>
                        <option value="active">Active Only</option>
                        <option value="inactive">Inactive Only</option>
                      </select>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {loading ? (
                      <div className="p-8 text-center text-sm text-slate-500">Loading vehicles...</div>
                    ) : filteredVehicles.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-600">
                        No vehicles match the selected filters.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                            <tr>
                              <th className="px-5 py-3.5">Vehicle</th>
                              <th className="px-4 py-3.5">Specs</th>
                              <th className="px-4 py-3.5 text-right">12h / 24h</th>
                              <th className="px-4 py-3.5">Status</th>
                              <th className="px-5 py-3.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredVehicles.map((car) => {
                              const isBusy = busyVehicleId === car.id;
                              return (
                                <tr key={car.id} className="hover:bg-slate-50/70">
                                  <td className="px-5 py-3.5">
                                    <div className="flex items-center gap-3">
                                      <div className="w-14 shrink-0 overflow-hidden rounded-md border border-slate-200">
                                        <VehicleImage
                                          src={car.image || car.images[0] || ''}
                                          alt={car.name}
                                          aspectClassName="aspect-[4/3]"
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-semibold text-[#0B1F3A]">{car.name}</div>
                                        <div className="text-xs text-slate-500 tabular-nums">
                                          {[car.year ? `${car.year}` : '', car.registrationNumber]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5 text-xs text-slate-600">
                                    {[car.fuelType, car.transmission, car.seats ? `${car.seats} Seats` : '']
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </td>
                                  <td className="px-4 py-3.5 text-right tabular-nums">
                                    <div className="font-semibold text-[#0B1F3A]">
                                      {car.price24h !== null ? `${formatINR(car.price24h)} / 24h` : '—'}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {car.price12h !== null ? `${formatINR(car.price12h)} / 12h` : '—'}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => void handleToggleActive(car)}
                                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                        car.isActive
                                          ? 'border-emerald-200 bg-emerald-50 text-[#166534] hover:bg-emerald-100'
                                          : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200'
                                      }`}
                                    >
                                      {car.isActive ? 'Active' : 'Inactive'}
                                    </button>
                                  </td>
                                  <td className="px-5 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingVehicle(car);
                                          setActiveSection('edit');
                                          setActionError('');
                                          setActionNotice('');
                                        }}
                                        aria-label={`Edit ${car.name}`}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Edit</span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedImageVehicleId(car.id);
                                          setActiveSection('images');
                                          setActionError('');
                                          setActionNotice('');
                                        }}
                                        aria-label={`Manage images for ${car.name}`}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Images</span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => setDeleteTarget(car)}
                                        aria-label={`Delete ${car.name}`}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Delete</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3. ADD VEHICLE */}
              {activeSection === 'add' && (
                <VehicleForm
                  mode="create"
                  detectedColumns={detectedColumns}
                  onCancel={() => setActiveSection('vehicles')}
                  onSaved={(saved, notice) => {
                    setActionNotice(notice);
                    setSelectedImageVehicleId(saved.id);
                    setActiveSection('vehicles');
                    reload();
                  }}
                />
              )}

              {/* 4. EDIT VEHICLE */}
              {activeSection === 'edit' && editingVehicle && (
                <VehicleForm
                  key={editingVehicle.id}
                  mode="edit"
                  initialVehicle={editingVehicle}
                  detectedColumns={detectedColumns}
                  onCancel={() => {
                    setEditingVehicle(null);
                    setActiveSection('vehicles');
                  }}
                  onManagePhotos={() => {
                    setSelectedImageVehicleId(editingVehicle.id);
                    setActiveSection('images');
                  }}
                  onSaved={(_saved, notice) => {
                    setActionNotice(notice);
                    setEditingVehicle(null);
                    setActiveSection('vehicles');
                    reload();
                  }}
                />
              )}

              {/* 5. VEHICLE IMAGES */}
              {activeSection === 'images' && (
                <VehicleImagesManager
                  vehicles={vehicles}
                  selectedVehicleId={selectedImageVehicleId || vehicles[0]?.id || ''}
                  onSelectVehicleId={setSelectedImageVehicleId}
                  detectedColumns={detectedColumns}
                  onRefreshVehicles={reload}
                />
              )}

              {/* MANAGE BOOKINGS */}
              {activeSection === 'bookings' && <AdminBookingsManager />}

              {/* 7. RENTAL PRICING */}
              {activeSection === 'pricing' && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="font-display text-base font-bold text-[#0B1F3A]">Rental Pricing Schedule</h2>
                    <p className="mt-1 text-xs text-slate-600">
                      Update 12-hour rates, 24-hour rates, and refundable security deposits in Indian Rupees (₹).
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <tr>
                          <th className="px-5 py-3">Vehicle</th>
                          <th className="px-4 py-3">12h Price (₹)</th>
                          <th className="px-4 py-3">24h Price (₹)</th>
                          <th className="px-4 py-3">Security Deposit (₹)</th>
                          <th className="px-5 py-3 text-right">Save</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vehicles.map((car) => {
                          const draft = getPricingDraft(car);
                          const isBusy = busyVehicleId === car.id;
                          return (
                            <tr key={car.id}>
                              <td className="px-5 py-3.5 font-semibold text-[#0B1F3A]">{car.name}</td>
                              <td className="px-4 py-3.5">
                                <input
                                  type="number"
                                  min={1}
                                  step="50"
                                  aria-label={`12h price for ${car.name}`}
                                  value={draft.price12h}
                                  onChange={(e) =>
                                    setPricingDrafts((prev) => ({
                                      ...prev,
                                      [car.id]: { ...draft, price12h: e.target.value },
                                    }))
                                  }
                                  className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-[#0B1F3A] tabular-nums"
                                />
                              </td>
                              <td className="px-4 py-3.5">
                                <input
                                  type="number"
                                  min={1}
                                  step="50"
                                  aria-label={`24h price for ${car.name}`}
                                  value={draft.price24h}
                                  onChange={(e) =>
                                    setPricingDrafts((prev) => ({
                                      ...prev,
                                      [car.id]: { ...draft, price24h: e.target.value },
                                    }))
                                  }
                                  className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-[#0B1F3A] tabular-nums"
                                />
                              </td>
                              <td className="px-4 py-3.5">
                                <input
                                  type="number"
                                  min={0}
                                  step="500"
                                  aria-label={`Security deposit for ${car.name}`}
                                  value={draft.deposit}
                                  onChange={(e) =>
                                    setPricingDrafts((prev) => ({
                                      ...prev,
                                      [car.id]: { ...draft, deposit: e.target.value },
                                    }))
                                  }
                                  placeholder="—"
                                  className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-[#0B1F3A] tabular-nums"
                                />
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleSaveRowPricing(car)}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#0B1F3A] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
                                >
                                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                  <span>Save</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 8. BUSINESS SETTINGS */}
              {activeSection === 'settings' && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <h2 className="font-display text-lg font-bold text-[#0B1F3A]">Business Details</h2>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">Business Name</dt>
                        <dd className="font-semibold text-[#0B1F3A]">{BUSINESS_CONFIG.name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Operating Location</dt>
                        <dd className="font-semibold text-[#0B1F3A]">{BUSINESS_CONFIG.serviceArea}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">WhatsApp Inquiry Number</dt>
                        <dd className="font-medium text-slate-700">
                          {BUSINESS_CONFIG.whatsappNumber
                            ? 'Configured via VITE_WHATSAPP_NUMBER'
                            : 'Not set yet (configure VITE_WHATSAPP_NUMBER in AI Studio Secrets)'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Active Admin Account</dt>
                        <dd className="font-semibold text-[#0B1F3A]">{user?.email}</dd>
                      </div>
                    </dl>

                    <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                      <Link
                        to="/cars"
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                      >
                        View Customer Listings
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleAdminLogout()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <div className="flex items-center gap-2">
                      <Database className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                      <h2 className="font-display text-lg font-bold text-[#0B1F3A]">
                        Verified Schema &amp; Storage
                      </h2>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      Actual <code className="font-mono font-semibold">public.vehicles</code> columns:
                    </p>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-[#0B1F3A]">
                      {detectedColumns.join(', ')}
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-slate-600">
                      Columns detected on your <code className="font-mono font-semibold">profiles</code> row (ID key:{' '}
                      <code className="font-mono font-semibold">{profile?.idColumn || 'id'}</code>):
                    </p>
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-[#0B1F3A]">
                      {profile?.availableColumns && profile.availableColumns.length > 0
                        ? profile.availableColumns.join(', ')
                        : 'No profile row columns detected yet.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Vehicle Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F3A]/50 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-vehicle-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 id="delete-vehicle-title" className="font-display text-lg font-bold text-[#0B1F3A]">
              Confirm Vehicle Deletion
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Are you sure you want to delete <span className="font-semibold">{deleteTarget.name}</span>? If this
              vehicle has linked booking records, deletion will be blocked safely and you can deactivate it instead.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1F3A] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyVehicleId === deleteTarget.id}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {busyVehicleId === deleteTarget.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
                <span>Delete Vehicle</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
