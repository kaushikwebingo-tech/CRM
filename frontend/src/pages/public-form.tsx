import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicForm, submitPublicForm, PublicFormSpec } from '@/api/capture';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function PublicFormPage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const [formSpec, setFormSpec] = useState<PublicFormSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    fetchPublicForm(sourceId)
      .then((spec) => {
        setFormSpec(spec);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Form could not be loaded');
      })
      .finally(() => setLoading(false));
  }, [sourceId]);

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId) return;

    if (honeypot) {
      setSubmitted(true);
      return;
    }

    const errors: Record<string, string> = {};
    if (formSpec?.fields) {
      for (const field of formSpec.fields) {
        if (field.isRequired && (formData[field.key] == null || formData[field.key] === '')) {
          errors[field.key] = `${field.label} is required`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await submitPublicForm(sourceId, {
        ...formData,
        _hp: honeypot,
      });

      if (res.success) {
        setSubmitted(true);
        if (formSpec?.redirectUrl) {
          window.location.href = formSpec.redirectUrl;
        }
      } else {
        setError(res.message || 'Submission failed');
        if (Array.isArray(res.errors)) {
          const map: Record<string, string> = {};
          res.errors.forEach((err: any) => {
            if (err.field) map[err.field] = err.message;
          });
          setFieldErrors(map);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit form');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-sm font-medium">Loading form...</span>
        </div>
      </div>
    );
  }

  if (error && !formSpec) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Form Unavailable</h2>
          <p className="text-sm text-slate-600 mb-6">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Thank You!</h2>
          <p className="text-slate-600 mb-6">
            {formSpec?.successMessage || 'Your information has been successfully submitted.'}
          </p>
        </div>
      </div>
    );
  }

  const primaryColor = formSpec?.theme?.primaryColor || '#2563eb';

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-8 sm:p-10 border-b border-slate-100 bg-slate-900 text-white">
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              {formSpec?.title || formSpec?.name}
            </h1>
            {formSpec?.description && (
              <p className="text-slate-300 text-sm leading-relaxed">
                {formSpec.description}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-8 sm:p-10 space-y-6">
            <input
              type="text"
              name="_hp"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              style={{ display: 'none' }}
              tabIndex={-1}
              autoComplete="off"
            />

            {error && (
              <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-sm text-rose-800">{error}</p>
              </div>
            )}

            {formSpec?.fields.map((field) => {
              const hasError = !!fieldErrors[field.key];
              return (
                <div key={field.key} className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-800">
                    {field.label}
                    {field.isRequired && <span className="text-rose-500 ml-1">*</span>}
                  </label>

                  {field.type === 'select' && Array.isArray((field.config as any)?.options) ? (
                    <select
                      value={formData[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 bg-white transition ${
                        hasError
                          ? 'border-rose-300 focus:ring-rose-200'
                          : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100'
                      }`}
                    >
                      <option value="">Select an option...</option>
                      {((field.config as any)?.options as any[]).map((opt) => (
                        <option key={opt.id} value={opt.label || opt.id}>
                          {opt.label || opt.id}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'long_text' ? (
                    <textarea
                      rows={4}
                      value={formData[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 transition ${
                        hasError
                          ? 'border-rose-300 focus:ring-rose-200'
                          : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100'
                      }`}
                    />
                  ) : (
                    <input
                      type={
                        field.type === 'email'
                          ? 'email'
                          : field.type === 'phone'
                          ? 'tel'
                          : field.type === 'number' || field.type === 'currency'
                          ? 'number'
                          : field.type === 'date'
                          ? 'date'
                          : 'text'
                      }
                      value={formData[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 transition ${
                        hasError
                          ? 'border-rose-300 focus:ring-rose-200'
                          : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100'
                      }`}
                    />
                  )}

                  {field.helpText && (
                    <p className="text-xs text-slate-500">{field.helpText}</p>
                  )}

                  {hasError && (
                    <p className="text-xs font-medium text-rose-600">{fieldErrors[field.key]}</p>
                  )}
                </div>
              );
            })}

            <div className="pt-4">
              <button
                type="submit"
                disabled={submitting}
                style={{ backgroundColor: primaryColor }}
                className="w-full py-3 px-6 rounded-lg text-white font-semibold text-sm shadow-sm hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-offset-2 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>{formSpec?.submitButtonText || 'Submit'}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
export default PublicFormPage;
