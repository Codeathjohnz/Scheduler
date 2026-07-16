import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { PenTool, Upload, Trash2, Loader2 } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { usersAPI } from '../../services/api.js'

export default function SignatureSettings() {
  const [signature, setSignature] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const fileInputRef = useRef(null)

  const load = () => {
    usersAPI.getSignature()
      .then(r => setSignature(r.data.signature_image))
      .catch(() => toast.error('Failed to load your signature.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'image/png') {
      toast.error('Please upload a PNG image (transparent background recommended).')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Signature image is too large (max 2MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      setSaving(true)
      try {
        await usersAPI.setSignature(reader.result)
        setSignature(reader.result)
        toast.success('Signature saved. It will be attached to the Faculty Loading form once you confirm a submission.')
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to save signature.')
      } finally {
        setSaving(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRemove = async () => {
    if (!confirm('Remove your saved e-signature?')) return
    setSaving(true)
    try {
      await usersAPI.removeSignature()
      setSignature(null)
      toast.success('Signature removed.')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove signature.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="My E-Signature"
        subtitle="Upload a signature image once — it's automatically attached to the Faculty Loading DOCX for any submission you confirm."
      />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-xl">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
          </div>
        ) : (
          <>
            <div className="border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center py-10 mb-5 bg-gray-50">
              {signature ? (
                <img src={signature} alt="Your signature" className="max-h-24 max-w-full" />
              ) : (
                <div className="text-center text-gray-400">
                  <PenTool className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No signature uploaded yet.</p>
                </div>
              )}
            </div>

            <input ref={fileInputRef} type="file" accept="image/png" className="hidden" onChange={handleFileChange} />

            <div className="flex gap-3">
              <button onClick={() => fileInputRef.current?.click()} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {signature ? 'Replace Signature' : 'Upload Signature'}
              </button>
              {signature && (
                <button onClick={handleRemove} disabled={saving}
                  className="flex items-center gap-2 bg-white hover:bg-red-50 border-2 border-gray-200 hover:border-red-300 text-gray-600 hover:text-red-600 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-4">
              PNG only, transparent background recommended, max 2MB. Crop it tightly around the signature itself for the best fit on the form.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
