// ============================================================
// src/hooks/useFieldValidation.js
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { validateForm, transformForm, validateFieldLive } from '../utils/validator';

const cache = {};

export function useFieldValidation(entityKey, context = {}) {
  const [rules,   setRules]   = useState([]);
  const [errors,  setErrors]  = useState({});
  const [loading, setLoading] = useState(true);

  // Keep context in a ref so callbacks don't need it as a dependency
  const contextRef = useRef(context);
  useEffect(() => { contextRef.current = context; });

  useEffect(() => {
    if (!entityKey) return;

    if (cache[entityKey]) {
      setRules(cache[entityKey]);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('accessToken');
    fetch(`/api/field-validation/${entityKey}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(res => {
        const r = res.data || [];
        cache[entityKey] = r;
        setRules(r);
      })
      .catch(err => {
        console.warn('useFieldValidation: failed to load rules for', entityKey, err);
      })
      .finally(() => setLoading(false));
  }, [entityKey]);

  // Keep rules in a ref too so callbacks always use latest rules
  const rulesRef = useRef(rules);
  useEffect(() => { rulesRef.current = rules; }, [rules]);

  const validate = useCallback((formData) => {
    const errs = validateForm(formData, rulesRef.current, contextRef.current);
    if (errs) {
      setErrors(errs);
      return null;
    }
    setErrors({});
    return transformForm(formData, rulesRef.current);
  }, []);

  const transform = useCallback((formData) => {
    return transformForm(formData, rulesRef.current);
  }, []);

  const liveValidate = useCallback((fieldKey, value) => {
    const error = validateFieldLive(fieldKey, value, rulesRef.current, contextRef.current);
    setErrors(prev => {
      if (!error) {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      }
      return { ...prev, [fieldKey]: error };
    });
    return error;
  }, []);

  const clearErrors = useCallback((fieldKey) => {
    if (fieldKey) {
      setErrors(prev => { const next = { ...prev }; delete next[fieldKey]; return next; });
    } else {
      setErrors({});
    }
  }, []);

  const isRequired = useCallback((fieldKey) => {
    return rulesRef.current.find(r => r.field_key === fieldKey)?.is_required || false;
  }, []);

  return { rules, errors, loading, validate, transform, liveValidate, clearErrors, isRequired };
}

export function invalidateValidationCache(entityKey) {
  if (entityKey) delete cache[entityKey];
  else Object.keys(cache).forEach(k => delete cache[k]);
}
