import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';

export default function RolePermissionsPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/admin/roles')
      .then(({ data }) => {
        if (!active) return;
        setRoles(data.data.roles);
        setPermissions(data.data.permissions);
        setSelectedRole(data.data.roles.find((role) => role.editable)?.name || '');
      })
      .catch(() => {
        if (active) setError(t('admin.rolePermissionsLoadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [t]);

  const selected = useMemo(
    () => roles.find((role) => role.name === selectedRole),
    [roles, selectedRole],
  );

  const togglePermission = (code, checked) => {
    setRoles((current) => current.map((role) => {
      if (role.name !== selectedRole) return role;
      const currentPermissions = new Set(role.permissions);
      if (checked) currentPermissions.add(code);
      else currentPermissions.delete(code);
      return { ...role, permissions: [...currentPermissions] };
    }));
  };

  const save = async () => {
    if (!selected?.editable) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/admin/roles/${selected.name}/permissions`, {
        permissions: selected.permissions,
      });
      setRoles((current) => current.map((role) => (
        role.name === selected.name ? data.data.role : role
      )));
      notify(t('admin.rolePermissionsSaved'));
    } catch {
      setError(t('admin.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('admin.administration')}</p>
          <h1>{t('admin.rolePermissions')}</h1>
          <p className="page-heading__description">{t('admin.rolePermissionsDescription')}</p>
        </div>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <Card className="role-permissions-card">
        <Select
          id="role-permissions-role"
          label={t('admin.role')}
          onChange={(event) => {
            setSelectedRole(event.target.value);
            setError('');
          }}
          value={selectedRole}
        >
          {roles.map((role) => (
            <option key={role.name} value={role.name}>{t(`roles.${role.name}`)}</option>
          ))}
        </Select>
        {selected && (
          <>
            <p>{selected.editable
              ? t('admin.rolePermissionsHint')
              : t('admin.superAdminPermissionsLocked')}</p>
            <div className="role-permissions-grid">
              {permissions.map((permission) => (
                <label className="setting-toggle" key={permission.code}>
                  <input
                    checked={selected.permissions.includes(permission.code)}
                    disabled={!selected.editable}
                    onChange={(event) => togglePermission(permission.code, event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{permission.code}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <Button disabled={!selected.editable || saving} onClick={save} type="button">
              {saving ? t('loading') : t('admin.saveRolePermissions')}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
