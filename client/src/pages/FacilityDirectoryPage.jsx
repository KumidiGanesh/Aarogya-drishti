import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, Save, RotateCcw } from 'lucide-react';
import api from '../services/api.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';

const EMPTY = { name: '', area: '', facility_type: 'unverified', verification_status: 'unverified', is_active: true, manager_user_id: null };
const TYPES = ['unverified', 'hospital', 'chc', 'phc', 'other'];

export default function FacilityDirectoryPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [managers, setManagers] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [facilitiesResponse, managersResponse] = await Promise.all([
        api.get('/admin/facilities', { params: { search: search || undefined } }),
        api.get('/admin/users', { params: { role: 'admin', status: 'active', page: 1, limit: 100 } }),
      ]);
      setItems(facilitiesResponse.data.data.items);
      setManagers(managersResponse.data.data.items);
      setError('');
    } catch {
      setError(t('facilityDirectory.loadFailed'));
    } finally { setLoading(false); }
  }, [search, t]);
  useEffect(() => { void load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post('/admin/facilities', form);
      setForm(EMPTY);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || t('facilityDirectory.addFailed'));
    } finally { setSaving(false); }
  };

  const update = async (item, fields) => {
    try {
      await api.put(`/admin/facilities/${item.id}`, fields);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || t('facilityDirectory.updateFailed'));
    }
  };
  const areas = [...new Set(items.map((item) => item.area).filter(Boolean))].sort();
  const visibleItems = items.filter((item) => (typeFilter === 'all' || item.facility_type === typeFilter)
    && (areaFilter === 'all' || item.area === areaFilter));

  return (
    <div className="admin-page facility-directory-page">
      <div className="page-heading">
        <div><p className="eyebrow">{t('facilityDirectory.superAdmin')}</p><h1>{t('facilityDirectory.title')}</h1>
          <p className="page-heading__description">{t('facilityDirectory.description')}</p></div>
      </div>
      <section className="facility-directory-stats" aria-label={t('facilityDirectory.totals')}>
        {[[t('facilityDirectory.allLocations'), items.length], [t('facilityDirectory.active'), items.filter((item) => item.is_active).length], [t('facilityDirectory.inactive'), items.filter((item) => !item.is_active).length], [t('facilityDirectory.unverified'), items.filter((item) => item.verification_status !== 'verified').length]].map(([label, count]) => (
          <Card key={label}><span>{label}</span><strong>{count}</strong></Card>
        ))}
      </section>
      <Card>
        <form className="facility-directory-add" onSubmit={create}>
          <Input id="facility-name" label={t('facilityDirectory.locationName')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <Input id="facility-area" label={t('facilityDirectory.areaOptional')} value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} />
          <label className="facility-directory-field">{t('facilityDirectory.facilityType')}<select value={form.facility_type} onChange={(event) => setForm({ ...form, facility_type: event.target.value })}>{TYPES.map((type) => <option key={type} value={type}>{type === 'unverified' ? t('facilityDirectory.unverified') : t(`facilityDirectory.types.${type}`)}</option>)}</select></label>
          <label className="facility-directory-field">{t('facilityDirectory.manager')}<select value={form.manager_user_id || ''} onChange={(event) => setForm({ ...form, manager_user_id: event.target.value || null })}><option value="">{t('facilityDirectory.unassigned')}</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></label>
          <Button disabled={saving} type="submit"><Plus size={17} /> {t('facilityDirectory.addLocation')}</Button>
        </form>
      </Card>
      <Card className="facility-directory-card">
        <div className="facility-directory-toolbar">
          <label className="facility-directory-search"><Search size={18} /><input aria-label={t('facilityDirectory.searchLocations')} placeholder={t('facilityDirectory.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <select aria-label={t('facilityDirectory.filterType')} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">{t('facilityDirectory.allTypes')}</option>{TYPES.map((type) => <option key={type} value={type}>{type === 'unverified' ? t('facilityDirectory.unverified') : t(`facilityDirectory.types.${type}`)}</option>)}</select>
          <select aria-label={t('facilityDirectory.filterArea')} value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="all">{t('facilityDirectory.allAreas')}</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select>
          <Button onClick={() => void load()} variant="secondary"><RotateCcw size={16} /> {t('facilityDirectory.refresh')}</Button>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {loading ? <Loading /> : (
          <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('facilityDirectory.location')}</th><th>{t('facilityDirectory.area')}</th><th>{t('facilityDirectory.type')}</th><th>{t('facilityDirectory.verification')}</th><th>{t('facilityDirectory.manager')}</th><th>{t('facilityDirectory.status')}</th><th>{t('save')}</th></tr></thead>
            <tbody>{visibleItems.map((item) => <FacilityRow key={item.id} item={item} managers={managers} onSave={update} t={t} />)}
              {!visibleItems.length && <tr><td className="table-empty" colSpan="7">{t('facilityDirectory.noLocations')}</td></tr>}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function FacilityRow({ item, managers, onSave, t }) {
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);
  return <tr>
    <td><input aria-label={t('facilityDirectory.locationName')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></td>
    <td><input aria-label={t('facilityDirectory.area')} value={draft.area || ''} onChange={(event) => setDraft({ ...draft, area: event.target.value })} /></td>
    <td><select aria-label={t('facilityDirectory.facilityType')} value={draft.facility_type || 'unverified'} onChange={(event) => setDraft({ ...draft, facility_type: event.target.value })}>{TYPES.map((type) => <option key={type} value={type}>{type === 'unverified' ? t('facilityDirectory.unverified') : t(`facilityDirectory.types.${type}`)}</option>)}</select></td>
    <td><select aria-label={t('facilityDirectory.verification')} value={draft.verification_status || 'unverified'} onChange={(event) => setDraft({ ...draft, verification_status: event.target.value })}><option value="unverified">{t('facilityDirectory.unverified')}</option><option value="verified">{t('facilityDirectory.verified')}</option></select></td>
    <td><select aria-label={t('facilityDirectory.manager')} value={draft.manager_user_id || ''} onChange={(event) => setDraft({ ...draft, manager_user_id: event.target.value || null })}><option value="">{t('facilityDirectory.unassigned')}</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></td>
    <td><button className={`facility-status ${draft.is_active ? 'is-active' : ''}`} onClick={() => setDraft({ ...draft, is_active: !draft.is_active })} type="button">{draft.is_active ? t('facilityDirectory.active') : t('facilityDirectory.inactive')}</button></td>
    <td><Button aria-label={t('facilityDirectory.saveLocation', { name: item.name })} onClick={() => onSave(item, { name: draft.name, area: draft.area, facility_type: draft.facility_type, verification_status: draft.verification_status, is_active: draft.is_active, manager_user_id: draft.manager_user_id || null })} variant="secondary"><Save size={16} /> {t('save')}</Button></td>
  </tr>;
}
