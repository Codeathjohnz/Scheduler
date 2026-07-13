import { useState } from 'react'
import { otpAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import { X, Mail, KeyRound, ShieldCheck, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react'

const STEP = { SEND: 1, VERIFY: 2, NEW_PW: 3, DONE: 4 }

export default function ChangePasswordModal({ onClose }) {
  const [step, setStep]         = useState(STEP.SEND)
  const [loading, setLoading]   = useState(false)
  const [otpSentMsg, setOtpSentMsg] = useState('')
  const [otp, setOtp]           = useState('')
  const [verifiedOtp, setVerifiedOtp] = useState('')
  const [newPw, setNewPw]       = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleSendOTP = async () => {
    setLoading(true)
    try {
      const res = await otpAPI.send()
      setOtpSentMsg(res.data.message)
      setStep(STEP.VERIFY)
      toast.success('OTP sent! Check your email.')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send OTP. Make sure your email is set in your profile.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) { toast.error('Enter the 6-digit OTP from your email.'); return }
    setLoading(true)
    try {
      await otpAPI.verify(otp)
      setVerifiedOtp(otp)
      setStep(STEP.NEW_PW)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid or expired OTP.')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters.'); return }
    if (newPw !== confirmPw) { toast.error('Passwords do not match.'); return }
    setLoading(true)
    try {
      await otpAPI.changePassword(verifiedOtp, newPw)
      setStep(STEP.DONE)
      toast.success('Password changed successfully!')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password. Please start over.')
    } finally {
      setLoading(false)
    }
  }

  const StepDot = ({ n }) => (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition ${
      step > n  ? 'bg-green-700 border-green-700 text-white'
      : step === n ? 'bg-white border-green-700 text-green-700'
      : 'bg-white border-gray-300 text-gray-400'
    }`}>{step > n ? <CheckCircle2 className="w-4 h-4" /> : n}</div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-green-800 rounded-t-2xl">
          <div>
            <p className="text-white font-bold">Change Password</p>
            <p className="text-green-300 text-xs mt-0.5">Secure OTP verification required</p>
          </div>
          <button onClick={onClose} className="text-green-300 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        {step !== STEP.DONE && (
          <div className="flex items-center justify-center gap-3 px-6 pt-5 pb-2">
            <StepDot n={1} />
            <div className={`h-0.5 w-10 rounded ${step > 1 ? 'bg-green-700' : 'bg-gray-200'}`} />
            <StepDot n={2} />
            <div className={`h-0.5 w-10 rounded ${step > 2 ? 'bg-green-700' : 'bg-gray-200'}`} />
            <StepDot n={3} />
          </div>
        )}

        <div className="px-6 pb-6 pt-4">
          {/* STEP 1 — Send OTP */}
          {step === STEP.SEND && (
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-7 h-7 text-green-700" />
              </div>
              <h3 className="font-bold text-gray-800 mb-1">Send OTP to Your Email</h3>
              <p className="text-sm text-gray-500 mb-6">
                We will send a 6-digit code to your registered email address. Make sure your Admin has added your email to your account.
              </p>
              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Mail className="w-4 h-4" /> Send OTP</>}
              </button>
            </div>
          )}

          {/* STEP 2 — Enter OTP */}
          {step === STEP.VERIFY && (
            <div>
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <KeyRound className="w-7 h-7 text-amber-600" />
                </div>
                <h3 className="font-bold text-gray-800 mb-1">Enter the OTP</h3>
                <p className="text-sm text-gray-500">{otpSentMsg || 'Check your email for the 6-digit code.'}</p>
              </div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">6-Digit OTP</label>
              <input
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 482910"
                maxLength={6}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-widest focus:outline-none focus:border-green-500 transition mb-4"
              />
              <div className="flex gap-3">
                <button onClick={handleVerifyOTP} disabled={loading || otp.length !== 6}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : 'Verify OTP'}
                </button>
                <button onClick={() => { setOtp(''); setStep(STEP.SEND) }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                  Resend
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — New Password */}
          {step === STEP.NEW_PW && (
            <div>
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <ShieldCheck className="w-7 h-7 text-blue-600" />
                </div>
                <h3 className="font-bold text-gray-800 mb-1">Set New Password</h3>
                <p className="text-sm text-gray-500">OTP verified. Enter your new password below.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">New Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:border-green-500 transition"
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:border-green-500 transition"
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <button onClick={handleChangePassword} disabled={loading || !newPw || !confirmPw}
                className="w-full mt-5 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Changing Password...</> : <><ShieldCheck className="w-4 h-4" /> Change Password</>}
              </button>
            </div>
          )}

          {/* STEP 4 — Done */}
          {step === STEP.DONE && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-9 h-9 text-green-700" />
              </div>
              <h3 className="font-bold text-gray-800 mb-1 text-lg">Password Changed!</h3>
              <p className="text-sm text-gray-500 mb-6">Your password has been updated successfully. Use your new password the next time you log in.</p>
              <button onClick={onClose}
                className="w-full bg-green-700 hover:bg-green-800 text-white font-bold py-2.5 rounded-xl transition text-sm">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
