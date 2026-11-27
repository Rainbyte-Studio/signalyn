import React, { useState, useMemo } from 'react';
import {
  UserCheck,
  Building2,
  Smartphone,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  Search,
  AlertCircle,
  Layers,
  Sparkles,
  Link as LinkIcon,
  ShieldCheck,
  Cpu,
  Plus,
  X,
  ArrowRight,
  Tag,
  AlertTriangle,
  Radio,
  Check,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  EntityReview,
  ReviewStatus,
  ProductLifecycleStatus,
  ProductEntityLevel,
  Company,
  Product,
} from '../../types';
import {
  classifyNonDeviceConcept,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  normalizeEntityKey,
  resolveCompanySafe,
  resolveProductSafe,
  validateCanonicalAlias,
} from '../../services/canonicalEntities';
import { deriveEntityFamilyGroupKey } from '../../services/entityReviewClientService';
import {
  AppPage,
  PageHeader,
  SemanticBadge,
  FilterToolbar,
  SearchInput,
  SelectControl,
  EmptyStateCard,
} from '../common/DesignSystem';

function formatReviewStatusLabel(status: ReviewStatus): string {
  switch (status) {
    case 'PROMOTED_NEW':
      return 'Promoted';
    case 'RESOLVED_EXISTING':
    case 'APPROVED':
      return 'Linked';
    case 'DISMISSED_NON_STRATEGIC':
      return 'Dismissed';
    case 'REJECTED':
      return 'Rejected';
    case 'MERGED':
      return 'Merged';
    default:
      return 'Pending';
  }
}

export const EntityReviewsView: React.FC = () => {
  const {
    canManage,
    entityReviews,
    companies,
    products,
    linkEntityReview,
    promoteCompanyFromReview,
    promoteProductFromReview,
    dismissReviewAsNonStrategic,
    rejectReview,
    batchLinkEntityReviews,
    batchDismissEntityReviews,
    notify,
  } = useApp();

  const [selectedStatus, setSelectedStatus] = useState<string>('PENDING');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [triageFilter, setTriageFilter] = useState<'ALL' | 'MATCHED' | 'NON_HARDWARE' | 'DUPLICATES'>('ALL');
  const [viewMode, setViewMode] = useState<'LIST' | 'GROUPED'>('LIST');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals state
  const [activeModal, setActiveModal] = useState<
    'NONE' | 'LINK' | 'PROMOTE_COMPANY' | 'PROMOTE_PRODUCT' | 'DISMISS' | 'REJECT' | 'BATCH_LINK' | 'BATCH_DISMISS'
  >('NONE');
  const [targetReview, setTargetReview] = useState<EntityReview | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form states
  // Link Modal
  const [selectedCanonicalId, setSelectedCanonicalId] = useState<string>('');
  const [addAliasOnLink, setAddAliasOnLink] = useState<boolean>(true);

  // Promote Company Modal
  const [companyFormName, setCompanyFormName] = useState<string>('');
  const [companyFormAliases, setCompanyFormAliases] = useState<string>('');
  const [companyFormCategories, setCompanyFormCategories] = useState<string[]>(['Smartphones']);
  const [companyFormTracked, setCompanyFormTracked] = useState<boolean>(false);

  // Promote Product Modal
  const [productFormName, setProductFormName] = useState<string>('');
  const [productFormCompanyId, setProductFormCompanyId] = useState<string>('');
  const [productFormCategory, setProductFormCategory] = useState<string>('Smartphones');
  const [productFormSubcategory, setProductFormSubcategory] = useState<string>('');
  const [productFormLifecycle, setProductFormLifecycle] = useState<ProductLifecycleStatus>('RUMORED');
  const [productFormLevel, setProductFormLevel] = useState<ProductEntityLevel>('PRODUCT_MODEL');
  const [productFormAliases, setProductFormAliases] = useState<string>('');

  // Dismiss / Reject Modal
  const [reasonInput, setReasonInput] = useState<string>('');

  // Dynamic merged canonical registries (Static + Firestore)
  const mergedCompanies = useMemo(() => getMergedCanonicalCompanies(companies), [companies]);
  const mergedProducts = useMemo(() => getMergedCanonicalProducts(products), [products]);

  // Identify cross-category duplicate normalized keys among pending reviews
  const duplicatePendingKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of entityReviews) {
      if (r.status !== 'PENDING') continue;
      const key = `${r.type}:${normalizeEntityKey(r.detectedName)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const dups = new Set<string>();
    for (const [k, c] of counts.entries()) {
      if (c > 1) dups.add(k);
    }
    return dups;
  }, [entityReviews]);

  const filteredReviews = useMemo(() => {
    return entityReviews.filter((r) => {
      if (selectedStatus === 'PENDING' && r.status !== 'PENDING') return false;
      if (
        selectedStatus === 'RESOLVED' &&
        r.status !== 'APPROVED' &&
        r.status !== 'RESOLVED_EXISTING' &&
        r.status !== 'PROMOTED_NEW'
      )
        return false;
      if (selectedStatus === 'DISMISSED' && r.status !== 'DISMISSED_NON_STRATEGIC') return false;
      if (selectedStatus === 'REJECTED' && r.status !== 'REJECTED') return false;
      if (selectedType !== 'ALL' && r.type !== selectedType) return false;

      if (triageFilter === 'MATCHED') {
        const hasMatch =
          r.type === 'COMPANY'
            ? Boolean(resolveCompanySafe(r.detectedName, mergedCompanies).matchedCompany)
            : Boolean(resolveProductSafe(r.detectedName, r.category, mergedProducts).matchedProduct);
        if (!hasMatch) return false;
      } else if (triageFilter === 'NON_HARDWARE') {
        if (!classifyNonDeviceConcept(r.detectedName)) return false;
      } else if (triageFilter === 'DUPLICATES') {
        const key = `${r.type}:${normalizeEntityKey(r.detectedName)}`;
        if (!duplicatePendingKeys.has(key)) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = r.detectedName.toLowerCase().includes(q);
        const matchesArticle = r.articleTitle?.toLowerCase().includes(q);
        const matchesSuggested =
          r.suggestedCompany?.toLowerCase().includes(q) ||
          r.suggestedProduct?.toLowerCase().includes(q);
        if (!matchesName && !matchesArticle && !matchesSuggested) return false;
      }
      return true;
    });
  }, [entityReviews, selectedStatus, selectedType, triageFilter, searchQuery, mergedCompanies, mergedProducts, duplicatePendingKeys]);

  const groupedReviews = useMemo(() => {
    const groups = new Map<string, EntityReview[]>();
    for (const r of filteredReviews) {
      const key = deriveEntityFamilyGroupKey(r);
      const list = groups.get(key) || [];
      list.push(r);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [filteredReviews]);

  const selectedPendingReviews = useMemo(() => {
    const set = new Set(selectedIds);
    return entityReviews.filter((r) => r.status === 'PENDING' && set.has(r.id));
  }, [entityReviews, selectedIds]);

  const selectedBatchEntityType = useMemo<'COMPANY' | 'PRODUCT' | 'MIXED' | null>(() => {
    if (selectedPendingReviews.length === 0) return null;
    const types = new Set(selectedPendingReviews.map((r) => r.type));
    if (types.size > 1) return 'MIXED';
    return selectedPendingReviews[0].type;
  }, [selectedPendingReviews]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleSelectGroup = (items: EntityReview[]) => {
    const pendingIds = items.filter((r) => r.status === 'PENDING').map((r) => r.id);
    if (pendingIds.length === 0) return;
    const allSelected = pendingIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      const removeSet = new Set(pendingIds);
      setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pendingIds])));
    }
  };

  const pendingCount = entityReviews.filter((r) => r.status === 'PENDING').length;
  const resolvedCount = entityReviews.filter(
    (r) => r.status === 'APPROVED' || r.status === 'RESOLVED_EXISTING' || r.status === 'PROMOTED_NEW'
  ).length;
  const dismissedCount = entityReviews.filter((r) => r.status === 'DISMISSED_NON_STRATEGIC').length;
  const rejectedCount = entityReviews.filter((r) => r.status === 'REJECTED').length;

  // Handlers to open modals
  const openLinkModal = (review: EntityReview, suggestedCanonicalId?: string) => {
    setTargetReview(review);
    setSelectedCanonicalId(suggestedCanonicalId || '');
    setAddAliasOnLink(true);
    setFormError(null);
    setActiveModal('LINK');
  };

  const openPromoteModal = (review: EntityReview) => {
    setTargetReview(review);
    setFormError(null);
    if (review.type === 'COMPANY') {
      setCompanyFormName(review.detectedName);
      setCompanyFormAliases('');
      setCompanyFormCategories(['Smartphones']);
      setCompanyFormTracked(false); // Strict default OFF
      setActiveModal('PROMOTE_COMPANY');
    } else {
      setProductFormName(review.detectedName);
      // Pre-fill company if suggested or matched
      const compMatch = review.suggestedCompany
        ? resolveCompanySafe(review.suggestedCompany, mergedCompanies).matchedCompany
        : null;
      setProductFormCompanyId(compMatch?.id || 'comp-apple');
      setProductFormCategory(review.category || 'Smartphones');
      setProductFormSubcategory('');
      setProductFormLifecycle('RUMORED');
      setProductFormLevel('PRODUCT_MODEL');
      setProductFormAliases('');
      setActiveModal('PROMOTE_PRODUCT');
    }
  };

  const openDismissModal = (review: EntityReview, defaultReason?: string) => {
    setTargetReview(review);
    setReasonInput(defaultReason || 'NON_STRATEGIC_CONCEPT');
    setFormError(null);
    setActiveModal('DISMISS');
  };

  const openRejectModal = (review: EntityReview) => {
    setTargetReview(review);
    setReasonInput('INVALID_OR_MALFORMED_EXTRACTION');
    setFormError(null);
    setActiveModal('REJECT');
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setActiveModal('NONE');
    setTargetReview(null);
    setFormError(null);
  };

  // Submission actions
  const handleConfirmLink = async () => {
    if (!targetReview || !selectedCanonicalId) {
      setFormError('Please select a target canonical entity.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      let canonicalName = '';
      if (targetReview.type === 'COMPANY') {
        const c = mergedCompanies.find((item) => item.id === selectedCanonicalId);
        canonicalName = c ? c.name : selectedCanonicalId;
      } else {
        const p = mergedProducts.find((item) => item.id === selectedCanonicalId);
        canonicalName = p ? p.name : selectedCanonicalId;
      }

      await linkEntityReview(targetReview.id, {
        canonicalId: selectedCanonicalId,
        canonicalName,
        entityType: targetReview.type,
        addAlias: addAliasOnLink,
      });
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Linking failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPromoteCompany = async () => {
    if (!targetReview) return;
    if (!companyFormName.trim()) {
      setFormError('Company name is required.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const aliases = companyFormAliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      await promoteCompanyFromReview(targetReview.id, {
        name: companyFormName.trim(),
        aliases,
        categories: companyFormCategories,
        tracked: companyFormTracked,
      });
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Promotion failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPromoteProduct = async () => {
    if (!targetReview) return;
    if (!productFormName.trim()) {
      setFormError('Product name is required.');
      return;
    }
    if (!productFormCompanyId) {
      setFormError('Please select an authoritative parent company.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const aliases = productFormAliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      await promoteProductFromReview(targetReview.id, {
        name: productFormName.trim(),
        companyId: productFormCompanyId,
        category: productFormCategory,
        subcategory: productFormSubcategory.trim() || undefined,
        lifecycle: productFormLifecycle,
        entityLevel: productFormLevel,
        aliases,
      });
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Promotion failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDismiss = async () => {
    if (!targetReview) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await dismissReviewAsNonStrategic(targetReview.id, reasonInput.trim() || undefined);
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Dismissal failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!targetReview) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await rejectReview(targetReview.id, reasonInput.trim() || undefined);
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Rejection failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openBatchLinkModal = () => {
    if (!canManage || selectedPendingReviews.length === 0) return;
    if (selectedBatchEntityType === 'MIXED') {
      notify('warning', 'Select One Entity Type', 'Filter to either Companies or Products before batch-linking to a single canonical entity.');
      return;
    }
    setSelectedCanonicalId('');
    setAddAliasOnLink(false);
    setFormError(null);
    setActiveModal('BATCH_LINK');
  };

  const openBatchDismissModal = () => {
    if (!canManage || selectedPendingReviews.length === 0) return;
    setReasonInput('NON_STRATEGIC_CONCEPT');
    setFormError(null);
    setActiveModal('BATCH_DISMISS');
  };

  const handleConfirmBatchLink = async () => {
    if (!selectedCanonicalId || selectedBatchEntityType === 'MIXED' || !selectedBatchEntityType) {
      setFormError('Please select a target canonical entity.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const canonicalName =
        selectedBatchEntityType === 'COMPANY'
          ? mergedCompanies.find((c) => c.id === selectedCanonicalId)?.name || selectedCanonicalId
          : mergedProducts.find((p) => p.id === selectedCanonicalId)?.name || selectedCanonicalId;

      await batchLinkEntityReviews(
        selectedPendingReviews.map((r) => r.id),
        {
          canonicalId: selectedCanonicalId,
          canonicalName,
          entityType: selectedBatchEntityType,
          addAlias: addAliasOnLink,
        }
      );
      setSelectedIds([]);
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Batch linking failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBatchDismiss = async () => {
    if (selectedPendingReviews.length === 0) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await batchDismissEntityReviews(
        selectedPendingReviews.map((r) => r.id),
        reasonInput.trim() || 'NON_STRATEGIC_CONCEPT'
      );
      setSelectedIds([]);
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Batch dismissal failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Entity Review & Promotion Queue"
        badges={<SemanticBadge variant="pending" label={`${pendingCount} Pending`} />}
        description="Human governance workflow: Link to existing canonical entities, promote verified new strategic hardware, or dismiss non-device concepts."
        actions={
          <SemanticBadge
            variant="neutral"
            icon={<Layers className="w-3.5 h-3.5 text-indigo-400" />}
            label={`Total Entities Detected: ${entityReviews.length}`}
            className="px-3 py-1.5 text-xs"
          />
        }
      />

      {/* Filter and Stats Bar */}
      <FilterToolbar>
        <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setSelectedStatus('PENDING')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors font-mono tabular-nums cursor-pointer ${
              selectedStatus === 'PENDING'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setSelectedStatus('RESOLVED')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors font-mono tabular-nums cursor-pointer ${
              selectedStatus === 'RESOLVED'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Resolved ({resolvedCount})
          </button>
          <button
            onClick={() => setSelectedStatus('DISMISSED')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors font-mono tabular-nums cursor-pointer ${
              selectedStatus === 'DISMISSED'
                ? 'bg-purple-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Dismissed ({dismissedCount})
          </button>
          <button
            onClick={() => setSelectedStatus('REJECTED')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors font-mono tabular-nums cursor-pointer ${
              selectedStatus === 'REJECTED'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Rejected ({rejectedCount})
          </button>
          <button
            onClick={() => setSelectedStatus('ALL')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors font-mono tabular-nums cursor-pointer ${
              selectedStatus === 'ALL'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({entityReviews.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search detected entities..."
            containerClassName="md:w-56"
          />

          <SelectControl
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            aria-label="Filter by Entity Type"
          >
            <option value="ALL">All Types</option>
            <option value="COMPANY">Companies</option>
            <option value="PRODUCT">Products</option>
          </SelectControl>

          <SelectControl
            value={triageFilter}
            onChange={(e) => setTriageFilter(e.target.value as any)}
            aria-label="Filter by Review Signal"
          >
            <option value="ALL">All Signals</option>
            <option value="MATCHED">Canonical Match Available</option>
            <option value="NON_HARDWARE">Non-Hardware Concepts</option>
            <option value="DUPLICATES">Duplicate Entries ({duplicatePendingKeys.size})</option>
          </SelectControl>

          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('LIST')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === 'LIST' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('GROUPED')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === 'GROUPED' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Grouped
            </button>
          </div>
        </div>
      </FilterToolbar>

      {/* Batch Resolution Action Bar (Admin Only) */}
      {canManage && selectedStatus === 'PENDING' && filteredReviews.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <button
              type="button"
              onClick={() => toggleSelectGroup(filteredReviews)}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition cursor-pointer"
            >
              {filteredReviews.every((r) => selectedIds.includes(r.id))
                ? 'Deselect Visible'
                : `Select Visible (${filteredReviews.length})`}
            </button>
            <span className="font-mono tabular-nums text-slate-400">
              {selectedPendingReviews.length} selected
            </span>
          </div>

          {selectedPendingReviews.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openBatchLinkModal}
                disabled={selectedBatchEntityType === 'MIXED'}
                title={
                  selectedBatchEntityType === 'MIXED'
                    ? 'Filter to only Companies or only Products to batch-link'
                    : 'Link all selected reviews to one canonical entity'
                }
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Link Selected ({selectedPendingReviews.length})</span>
              </button>
              <button
                type="button"
                onClick={openBatchDismissModal}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-900/50 rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Dismiss Selected ({selectedPendingReviews.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Review Queue Cards */}
      <div className="space-y-3">
        {filteredReviews.length === 0 ? (
          <EmptyStateCard
            icon={<UserCheck className="w-8 h-8 text-slate-600 mx-auto" />}
            title="No entities in queue matching current filter"
            description="Extracted entities are processed here through human governance."
            density="expanded"
          />
        ) : viewMode === 'GROUPED' ? (
          groupedReviews.map(([groupName, groupItems]) => {
            const pendingInGroup = groupItems.filter((r) => r.status === 'PENDING');
            const allGroupSelected =
              pendingInGroup.length > 0 && pendingInGroup.every((r) => selectedIds.includes(r.id));
            return (
              <div key={groupName} className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {canManage && pendingInGroup.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allGroupSelected}
                        onChange={() => toggleSelectGroup(groupItems)}
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                        aria-label={`Select all reviews in ${groupName}`}
                      />
                    )}
                    <span className="text-xs font-bold text-slate-100">{groupName}</span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {groupItems.length} {groupItems.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-slate-800/80">
                  {groupItems.map((review) => {
                    const isCompany = review.type === 'COMPANY';
                    const compRes = isCompany ? resolveCompanySafe(review.detectedName, mergedCompanies) : null;
                    const prodRes = !isCompany ? resolveProductSafe(review.detectedName, review.category, mergedProducts) : null;
                    const nonDeviceConcept = classifyNonDeviceConcept(review.detectedName);
                    const occurrences = review.occurrences || 1;
                    const hasCanonicalMatch = Boolean(compRes?.matchedCompany || prodRes?.matchedProduct);
                    const matchedTargetName = compRes?.matchedCompany?.name || prodRes?.matchedProduct?.name;
                    const matchedTargetId = compRes?.matchedCompany?.id || prodRes?.matchedProduct?.id;
                    const isSelected = selectedIds.includes(review.id);

                    return (
                      <div
                        key={review.id}
                        className={`p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition ${
                          isSelected ? 'bg-indigo-950/20' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {canManage && review.status === 'PENDING' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectId(review.id)}
                              className="mt-1 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                              aria-label={`Select ${review.detectedName}`}
                            />
                          )}
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-100">{review.detectedName}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                                {review.type === 'COMPANY' ? 'Company' : 'Product'}
                              </span>
                              {review.category && review.category !== 'OTHER' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 bg-slate-950 border border-slate-800">
                                  {review.category}
                                </span>
                              )}
                              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                                {occurrences} mention{occurrences === 1 ? '' : 's'} · {Math.round(review.confidence * 100)}%
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 truncate">
                              From: <span className="text-slate-300">"{review.articleTitle}"</span>
                            </p>
                            {hasCanonicalMatch && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300">
                                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                Suggested match: <strong>{matchedTargetName}</strong>
                              </span>
                            )}
                            {nonDeviceConcept && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 ml-2">
                                <Cpu className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                Non-hardware ({nonDeviceConcept.name})
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
                          {review.status === 'PENDING' ? (
                            canManage ? (
                              <>
                                <button
                                  onClick={() => openLinkModal(review, matchedTargetId)}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                                >
                                  Link
                                </button>
                                <button
                                  onClick={() => openPromoteModal(review)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                                >
                                  Promote
                                </button>
                                <button
                                  onClick={() => openDismissModal(review, nonDeviceConcept?.category)}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-900/50 rounded-lg text-xs font-medium transition cursor-pointer"
                                >
                                  Dismiss
                                </button>
                                <button
                                  onClick={() => openRejectModal(review)}
                                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 rounded-lg text-xs transition cursor-pointer"
                                  title="Reject invalid extraction"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-500">Admin required</span>
                            )
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              {formatReviewStatusLabel(review.status)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          filteredReviews.map((review) => {
            const isCompany = review.type === 'COMPANY';
            const compRes = isCompany ? resolveCompanySafe(review.detectedName, mergedCompanies) : null;
            const prodRes = !isCompany ? resolveProductSafe(review.detectedName, review.category, mergedProducts) : null;
            const nonDeviceConcept = classifyNonDeviceConcept(review.detectedName);
            const occurrences = review.occurrences || 1;
            const citingCount = review.articleIds?.length || 1;

            const hasCanonicalMatch = Boolean(compRes?.matchedCompany || prodRes?.matchedProduct);
            const matchedTargetName = compRes?.matchedCompany?.name || prodRes?.matchedProduct?.name;
            const matchedTargetId = compRes?.matchedCompany?.id || prodRes?.matchedProduct?.id;
            const isSelected = selectedIds.includes(review.id);

            return (
              <div
                key={review.id}
                className={`p-4 bg-slate-900 border rounded-xl transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                  isSelected ? 'border-indigo-500/60 bg-indigo-950/15' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {canManage && review.status === 'PENDING' && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectId(review.id)}
                      className="mt-2.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                      aria-label={`Select ${review.detectedName}`}
                    />
                  )}
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      isCompany
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {isCompany ? <Building2 className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-100">{review.detectedName}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {review.type === 'COMPANY' ? 'Company' : 'Product'}
                      </span>
                      {review.category && review.category !== 'OTHER' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 bg-slate-950 border border-slate-800">
                          {review.category}
                        </span>
                      )}
                      <span className="text-[10px] font-mono tabular-nums text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {occurrences} mention{occurrences === 1 ? '' : 's'}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-slate-500">
                        {Math.round(review.confidence * 100)}% confidence
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 truncate">
                      From article:{' '}
                      <span className="text-slate-200 font-medium">"{review.articleTitle}"</span>
                    </p>

                    {hasCanonicalMatch && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-950/50 border border-indigo-800/70 text-[11px] text-indigo-300">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span>
                          Suggested Match: <strong>{matchedTargetName}</strong>
                        </span>
                      </div>
                    )}

                    {nonDeviceConcept && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/50 border border-amber-800/70 text-[11px] text-amber-300">
                        <Cpu className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>
                          Non-Hardware Concept: <strong>{nonDeviceConcept.name}</strong> ({nonDeviceConcept.category})
                        </span>
                      </div>
                    )}

                    {review.canonicalId && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/50 text-[11px] text-emerald-300">
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        <span>
                          Linked to: <strong>{review.canonicalName || review.canonicalId}</strong>
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-0.5">
                      <span>Detected {new Date(review.createdAt).toLocaleDateString()}</span>
                      {review.suggestedCompany && <span>Parent: {review.suggestedCompany}</span>}
                      <span>{citingCount} article{citingCount === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </div>

                {/* Explicit Human Action Buttons (Admin Only) */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  {review.status === 'PENDING' ? (
                    canManage ? (
                      <>
                        <button
                          onClick={() => openLinkModal(review, matchedTargetId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                          title="Link to existing canonical Company or Product"
                        >
                          <LinkIcon className="w-3.5 h-3.5" />
                          <span>Link Existing</span>
                        </button>

                        <button
                          onClick={() => openPromoteModal(review)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                          title="Promote verified new strategic hardware to canonical registry"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Promote</span>
                        </button>

                        <button
                          onClick={() => openDismissModal(review, nonDeviceConcept?.category)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-medium border border-amber-900/50 transition cursor-pointer"
                          title="Dismiss non-hardware concepts (AI software, chipsets, OS, etc.)"
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          <span>Dismiss</span>
                        </button>

                        <button
                          onClick={() => openRejectModal(review)}
                          className="flex items-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 rounded-lg text-xs transition cursor-pointer"
                          title="Reject malformed or incorrect extraction"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg text-xs text-slate-500 bg-slate-950 border border-slate-800">
                        Read-only
                      </span>
                    )
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                          review.status === 'PROMOTED_NEW'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : review.status === 'RESOLVED_EXISTING' || review.status === 'APPROVED'
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                            : review.status === 'DISMISSED_NON_STRATEGIC'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {formatReviewStatusLabel(review.status)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: LINK TO EXISTING CANONICAL ENTITY */}
      {/* ========================================================================= */}
      {activeModal === 'LINK' && targetReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-slate-100">Link to Existing Canonical Entity</h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <p className="text-xs text-slate-400">Review Entity Detected:</p>
              <p className="text-sm font-bold text-slate-100">
                "{targetReview.detectedName}" ({targetReview.type})
              </p>
              {targetReview.category && (
                <p className="text-[11px] text-slate-500">Category: {targetReview.category}</p>
              )}
            </div>

            {formError && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Select Canonical {targetReview.type === 'COMPANY' ? 'Company' : 'Product'}:
                </label>
                <select
                  value={selectedCanonicalId}
                  onChange={(e) => setSelectedCanonicalId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Choose Canonical Target --</option>
                  {targetReview.type === 'COMPANY'
                    ? mergedCompanies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.id})
                        </option>
                      ))
                    : mergedProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.category}) - {p.id}
                        </option>
                      ))}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={addAliasOnLink}
                  onChange={(e) => setAddAliasOnLink(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Also register "{targetReview.detectedName}" as an alias on canonical record</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLink}
                disabled={isSubmitting || !selectedCanonicalId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition flex items-center gap-1.5"
              >
                {isSubmitting ? 'Linking...' : 'Confirm Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: PROMOTE NEW COMPANY */}
      {/* ========================================================================= */}
      {activeModal === 'PROMOTE_COMPANY' && targetReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-slate-100">Promote to Canonical Company</h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Canonical Company Name *
                </label>
                <input
                  type="text"
                  value={companyFormName}
                  onChange={(e) => setCompanyFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Nothing"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Brand Aliases (comma-separated)
                </label>
                <input
                  type="text"
                  value={companyFormAliases}
                  onChange={(e) => setCompanyFormAliases(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Nothing Technology, Nothing Phone"
                />
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={companyFormTracked}
                    onChange={(e) => setCompanyFormTracked(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-slate-200">
                    Track as Direct Competitor in Share of Voice (SOV)
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 pl-5">
                  Default is <strong>OFF</strong>. Only toggle ON if this OEM directly competes in Signalyn's primary device benchmarks.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPromoteCompany}
                disabled={isSubmitting || !companyFormName.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition flex items-center gap-1.5"
              >
                {isSubmitting ? 'Promoting...' : 'Promote Company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PROMOTE NEW PRODUCT */}
      {/* ========================================================================= */}
      {activeModal === 'PROMOTE_PRODUCT' && targetReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-slate-100">Promote to Canonical Product</h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Canonical Product Name *
                </label>
                <input
                  type="text"
                  value={productFormName}
                  onChange={(e) => setProductFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Apple iPhone Duo"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Parent Company *
                  </label>
                  <select
                    value={productFormCompanyId}
                    onChange={(e) => setProductFormCompanyId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    {mergedCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Strategic Category *
                  </label>
                  <select
                    value={productFormCategory}
                    onChange={(e) => setProductFormCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Smartphones">Smartphones</option>
                    <option value="Wearables">Wearables</option>
                    <option value="Tablets">Tablets</option>
                    <option value="Audio">Audio</option>
                    <option value="Laptops">Laptops</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Lifecycle Status *
                  </label>
                  <select
                    value={productFormLifecycle}
                    onChange={(e) => setProductFormLifecycle(e.target.value as ProductLifecycleStatus)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="RUMORED">RUMORED (Leak / Early Rumor)</option>
                    <option value="PROTOTYPE">PROTOTYPE (Internal / Concept)</option>
                    <option value="ANNOUNCED">ANNOUNCED (Official Announcement)</option>
                    <option value="RELEASED">RELEASED (Commercial Market)</option>
                    <option value="DISCONTINUED">DISCONTINUED</option>
                    <option value="UNKNOWN">UNKNOWN</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Entity Level *
                  </label>
                  <select
                    value={productFormLevel}
                    onChange={(e) => setProductFormLevel(e.target.value as ProductEntityLevel)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="PRODUCT_MODEL">PRODUCT_MODEL (Specific Device)</option>
                    <option value="PRODUCT_SERIES">PRODUCT_SERIES (Lineup / Series)</option>
                    <option value="PRODUCT_FAMILY">PRODUCT_FAMILY (Broad Architecture)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Subcategory / Form-Factor
                </label>
                <input
                  type="text"
                  value={productFormSubcategory}
                  onChange={(e) => setProductFormSubcategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Foldable Smartphone, Screenless Fitness Band"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Product Aliases (comma-separated)
                </label>
                <input
                  type="text"
                  value={productFormAliases}
                  onChange={(e) => setProductFormAliases(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. iPhone Fold, Apple Duo"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPromoteProduct}
                disabled={isSubmitting || !productFormName.trim() || !productFormCompanyId}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition flex items-center gap-1.5"
              >
                {isSubmitting ? 'Promoting...' : 'Promote Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DISMISS NON-STRATEGIC CONCEPT */}
      {/* ========================================================================= */}
      {activeModal === 'DISMISS' && targetReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <Cpu className="w-5 h-5" />
                <h2 className="text-base font-bold text-slate-100">Dismiss as Non-Strategic</h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Classifies "<strong>{targetReview.detectedName}</strong>" as a non-hardware or component concept (AI software, chipset, operating system, etc.). It will not pollute the strategic hardware catalog.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Classification Reason:
              </label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                placeholder="e.g. AI_SOFTWARE, CHIPSET_SILICON, OPERATING_SYSTEM"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDismiss}
                disabled={isSubmitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition"
              >
                {isSubmitting ? 'Dismissing...' : 'Dismiss Entity'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: REJECT REVIEW */}
      {/* ========================================================================= */}
      {activeModal === 'REJECT' && targetReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-400">
                <XCircle className="w-5 h-5" />
                <h2 className="text-base font-bold text-slate-100">Reject Entity Review</h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Rejects "<strong>{targetReview.detectedName}</strong>" as invalid, hallucinated, or malformed extraction.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Rejection Reason:
              </label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                placeholder="e.g. INVALID_EXTRACTION, MALFORMED_TOKEN"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition"
              >
                {isSubmitting ? 'Rejecting...' : 'Reject Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: BATCH LINK TO CANONICAL ENTITY */}
      {activeModal === 'BATCH_LINK' && selectedBatchEntityType && selectedBatchEntityType !== 'MIXED' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-slate-100">
                  Link {selectedPendingReviews.length} Selected Reviews
                </h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl max-h-32 overflow-y-auto space-y-1">
              <p className="text-[11px] font-semibold text-slate-400">Selected items:</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedPendingReviews.slice(0, 20).map((r) => (
                  <span key={r.id} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-200">
                    {r.detectedName}
                  </span>
                ))}
                {selectedPendingReviews.length > 20 && (
                  <span className="text-[11px] text-slate-400">+{selectedPendingReviews.length - 20} more</span>
                )}
              </div>
            </div>

            {formError && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Target Canonical {selectedBatchEntityType === 'COMPANY' ? 'Company' : 'Product'}
                </label>
                <select
                  value={selectedCanonicalId}
                  onChange={(e) => setSelectedCanonicalId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Choose Canonical Target --</option>
                  {selectedBatchEntityType === 'COMPANY'
                    ? mergedCompanies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    : mergedProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.category})
                        </option>
                      ))}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={addAliasOnLink}
                  onChange={(e) => setAddAliasOnLink(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Also register valid names as aliases on the target canonical record</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchLink}
                disabled={isSubmitting || !selectedCanonicalId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
              >
                {isSubmitting ? 'Linking...' : `Confirm Link (${selectedPendingReviews.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: BATCH DISMISS AS NON-STRATEGIC */}
      {activeModal === 'BATCH_DISMISS' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <Cpu className="w-5 h-5" />
                <h2 className="text-base font-bold text-slate-100">
                  Dismiss {selectedPendingReviews.length} Selected Reviews
                </h2>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Marks {selectedPendingReviews.length} explicitly selected entity review(s) as non-strategic concepts outside hardware scope.
            </p>

            {formError && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Reason
              </label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                placeholder="e.g. Non-hardware software, ecosystem, or general organization"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDismiss}
                disabled={isSubmitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
              >
                {isSubmitting ? 'Dismissing...' : `Confirm Dismiss (${selectedPendingReviews.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
};
