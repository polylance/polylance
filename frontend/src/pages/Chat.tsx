import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { usePolyLanceData } from '../context/PolyLanceDataContext';
import { useWeb3 } from '../context/Web3Context';
import { 
  MessageSquare, Send, ArrowUpRight, 
  Search, AlertCircle, FileCheck, DollarSign,
  Paperclip, Smile, MoreVertical, Copy, Shield, Download, ChevronRight, Lock
} from 'lucide-react';
import { truncateAddress } from '../utils/formatters';
import confetti from 'canvas-confetti';

export const Chat: React.FC = () => {
  const { jobId: urlJobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { address, currentRole, isConnected, isArbitrator, isTreasuryAdmin } = useWeb3();
  const { 
    jobs, profiles, sendChatMessage, proposeTerms, fundJob, 
    releasePayment, submitWork, requestModifications 
  } = usePolyLanceData();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(urlJobId || null);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedAddr, setCopiedAddr] = useState(false);
  
  // Interactive submission modal inside chat
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState('');
  const [submitDesc, setSubmitDesc] = useState('');
  const [submitLink, setSubmitLink] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // If URL contains a jobId, auto select it
  useEffect(() => {
    if (urlJobId) {
      setSelectedJobId(urlJobId);
    }
  }, [urlJobId]);

  // Securely filter jobs for conversation sidebar
  const myChats = jobs.filter(j => {
    if (isArbitrator || isTreasuryAdmin) return true;
    const lowerAddr = (address || '').toLowerCase();
    const isClient = j.client.toLowerCase() === lowerAddr;
    const isFreelancer = j.freelancer?.toLowerCase() === lowerAddr;
    const isJudgeOnDispute = isArbitrator && j.status === 'Disputed';

    return isClient || isFreelancer || isJudgeOnDispute;
  });

  // Default to the first conversation if none selected
  useEffect(() => {
    if (!selectedJobId && myChats.length > 0) {
      setSelectedJobId(myChats[0].id);
    }
  }, [myChats, selectedJobId]);

  const activeJob = jobs.find(j => j.id === selectedJobId);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeJob?.chatMessages]);

  const handleCopyAddress = (addrToCopy: string) => {
    navigator.clipboard.writeText(addrToCopy);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4 font-sans">
        <AlertCircle className="w-12 h-12 text-amber-600 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900 font-heading">Wallet Not Connected</h2>
        <p className="text-xs text-slate-500 font-mono">
          Please connect your wallet to access your end-to-end encrypted negotiation chats.
        </p>
      </div>
    );
  }

  // Handle message submission
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeJob) return;

    const isClient = activeJob.client.toLowerCase() === (address || '').toLowerCase();
    const senderRole = isArbitrator ? 'Judge' : (isClient ? 'Client' : 'Freelancer');
    sendChatMessage(activeJob.id, inputText, senderRole);
    setInputText('');
  };

  // Escrow direct actions
  const handleProposeTerms = () => {
    if (!activeJob) return;
    const isClient = activeJob.client.toLowerCase() === (address || '').toLowerCase();
    proposeTerms(activeJob.id, address);
    confetti({ particleCount: 50, spread: 60 });
    sendChatMessage(activeJob.id, `🔒 Terms signature hash submitted cryptographically by ${isClient ? 'Client' : 'Developer'}.`, 'Judge');
  };

  const handleFund = () => {
    if (!activeJob) return;
    fundJob(activeJob.id);
    confetti({ particleCount: 75, spread: 60 });
    sendChatMessage(activeJob.id, `💰 Escrow vault funded successfully. Budget of $${parseFloat(activeJob.amountUsdc).toLocaleString()} USDC is locked.`, 'Judge');
  };

  const handleRelease = () => {
    if (!activeJob) return;
    releasePayment(activeJob.id);
    confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
    sendChatMessage(activeJob.id, `🎉 Escrow Milestone approved. Funds released to Developer's wallet. SBT minted!`, 'Judge');
  };

  const handleSubmitDeliverable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob || !submitTitle.trim()) return;

    submitWork(activeJob.id, submitTitle, submitDesc, submitLink ? [submitLink] : []);
    setIsSubmitModalOpen(false);
    confetti({ particleCount: 60, spread: 50 });
    sendChatMessage(activeJob.id, `🚀 Work Submission: "${submitTitle}" submitted for Client review. Deliverable link: ${submitLink || 'N/A'}`, 'Freelancer');
  };

  const handleRequestRevision = () => {
    if (!activeJob) return;
    const note = prompt('Please explain what revisions are required:');
    if (!note) return;
    requestModifications(activeJob.id, note);
    sendChatMessage(activeJob.id, `⚠️ Revision Request: Client requested code changes. Note: "${note}"`, 'Client');
  };

  const filteredChats = myChats.filter(j => 
    j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    j.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-6 font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[85vh] border border-slate-200 bg-white rounded-3xl overflow-hidden shadow-2xl">
        
        {/* Left Side: Channels Sidebar (3 Cols) */}
        <div className="lg:col-span-3 border-r border-slate-200 flex flex-col h-full bg-slate-50/70 p-4 space-y-4">
          <div className="space-y-3 shrink-0">
            <h3 className="font-headline text-sm font-black text-slate-900 flex items-center gap-2">
              <MessageSquare size={16} className="text-purple-700" /> Escrow Channels
            </h3>
            
            <div className="relative">
              <input
                type="text"
                placeholder="Search escrow channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full !pl-8 !pr-3 !py-2 text-xs glass-input font-medium rounded-xl"
              />
              <Search className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider px-1">
                ACTIVE ESCROW CHANNELS
              </span>
              {filteredChats.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs font-medium">
                  No active escrow channels found for your account.
                </div>
              ) : (
                filteredChats.map((job) => {
                  const jobIsSelected = job.id === selectedJobId;
                  const activeRoleIsClient = job.client.toLowerCase() === (address || '').toLowerCase();
                  const activeCounterpartAddress = activeRoleIsClient ? (job.freelancer || job.applications?.[0]?.applicant || '') : job.client;
                  const activeCounterpartKey = activeCounterpartAddress 
                    ? Object.keys(profiles).find(k => k.toLowerCase() === activeCounterpartAddress.toLowerCase()) 
                    : null;
                  const activeCounterpartProfile = activeCounterpartKey ? profiles[activeCounterpartKey] : null;
                  const activeCounterpartName = activeCounterpartProfile?.displayName || truncateAddress(activeCounterpartAddress || '');
                  const lastMsg = job.chatMessages?.[job.chatMessages.length - 1];

                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`w-full p-3 rounded-2xl text-left transition-all border flex items-start gap-3 cursor-pointer ${
                        jobIsSelected 
                          ? 'bg-purple-700 text-white border-purple-800 shadow-md font-bold' 
                          : 'bg-white text-slate-700 border-slate-150 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase shrink-0 ${
                        jobIsSelected ? 'bg-purple-100 text-purple-900' : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                        {activeCounterpartName.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start">
                          <span className={`font-extrabold text-xs truncate max-w-[120px] ${jobIsSelected ? 'text-white' : 'text-slate-900'}`} style={jobIsSelected ? { color: '#FFFFFF' } : undefined}>
                            {activeCounterpartName}
                          </span>
                          <span className={`text-[9px] font-mono shrink-0 ${jobIsSelected ? 'text-purple-100 font-bold' : 'text-slate-500'}`} style={jobIsSelected ? { color: '#F3E8FF' } : undefined}>
                            ${parseFloat(job.amountUsdc || '0').toLocaleString()}
                          </span>
                        </div>
                        <p className={`text-[10px] truncate font-sans mt-0.5 ${jobIsSelected ? 'text-white font-bold' : 'text-slate-700'}`} style={jobIsSelected ? { color: '#FFFFFF' } : undefined}>
                          {job.title}
                        </p>
                        <p className={`text-[9px] truncate font-mono mt-1 ${jobIsSelected ? 'text-purple-100 font-medium' : 'text-slate-500'}`} style={jobIsSelected ? { color: '#E9D5FF' } : undefined}>
                          {lastMsg ? `${lastMsg.sender}: ${lastMsg.text}` : 'No messages yet'}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 shrink-0">
            <Link
              to="/jobs/post"
              className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-purple-700 font-bold py-2.5 rounded-2xl flex items-center justify-center gap-1.5 text-xs shadow-xs transition-all"
            >
              Post Escrow Job
            </Link>
          </div>
        </div>

        {/* Center: Live Messenger Feed (6 Cols) */}
        <div className="lg:col-span-6 flex flex-col h-full bg-slate-50/40">
          {activeJob ? (
            <>
              {/* Header Bar */}
              <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-600 text-white font-extrabold flex items-center justify-center text-sm uppercase shadow-sm">
                    {(activeJob.client.toLowerCase() === (address || '').toLowerCase() ? (activeJob.freelancer || 'Dev') : 'Client').slice(0, 2)}
                  </div>
                  <div>
                    <h4 className="font-headline font-bold text-slate-900 text-sm">{activeJob.title}</h4>
                    <p className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      XMTP Encrypted Private Channel
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    to={`/jobs/${activeJob.id}`}
                    className="text-xs font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 font-mono"
                  >
                    Details <ArrowUpRight size={14} />
                  </Link>
                  <button type="button" className="text-slate-400 hover:text-slate-600 cursor-pointer">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-white/40">
                <div className="flex justify-center my-2">
                  <span className="bg-slate-100 border border-slate-200 text-slate-500 text-[10px] font-mono font-bold px-3 py-0.5 rounded-full">
                    Today
                  </span>
                </div>

                {(activeJob.chatMessages || [
                  { sender: 'Client' as const, text: 'Welcome! Let us coordinate milestone specifications and delivery targets.', timestamp: activeJob.createdAt || Date.now() - 3600000 }
                ]).map((msg, index) => {
                  const isClient = activeJob.client.toLowerCase() === (address || '').toLowerCase();
                  const isUser = msg.sender === (isClient ? 'Client' : 'Freelancer') || (isArbitrator && msg.sender === 'Judge');
                  const isSystem = msg.sender === 'Judge' && !isArbitrator;

                  if (isSystem) {
                    return (
                      <div key={index} className="flex justify-center my-3">
                        <div className="bg-purple-50 border border-purple-200 text-purple-900 rounded-xl px-4 py-1.5 text-[10px] font-mono font-bold flex items-center gap-1.5">
                          <Lock size={12} className="text-purple-700" />
                          {msg.text}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div 
                      key={index}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-start gap-2.5`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-full bg-slate-700 text-white font-bold text-xs flex items-center justify-center shrink-0 uppercase shadow-xs mt-1">
                          {msg.sender.slice(0, 2)}
                        </div>
                      )}
                      <div className="max-w-md space-y-1">
                        <div className={`font-mono text-[10px] font-bold px-1 ${isUser ? 'text-right text-purple-700' : 'text-purple-700'}`}>
                          {msg.sender}
                        </div>
                        <div className={`p-3.5 rounded-2xl border text-xs shadow-xs ${
                          isUser 
                            ? 'bg-purple-50/90 border-purple-200 text-slate-900 rounded-tr-none' 
                            : 'bg-white border-slate-200 text-slate-800 rounded-tl-none font-medium'
                        }`}>
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          <div className={`text-right text-[8px] font-mono mt-1 flex items-center justify-end gap-1 ${isUser ? 'text-purple-600 font-bold' : 'text-slate-400'}`}>
                            <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isUser && <span className="text-purple-600 text-[10px]">✓✓</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Panel */}
              <div className="p-4 border-t border-slate-200 bg-white shrink-0 space-y-2">
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <div className="flex-1 flex items-center glass-input rounded-2xl px-3 py-1.5 bg-slate-50 border border-slate-200 shadow-inner">
                    <button type="button" className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                      <Paperclip size={16} />
                    </button>
                    <input
                      type="text"
                      placeholder="Message client or developer..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-xs font-semibold px-2 py-1.5 text-slate-800 placeholder-slate-400"
                    />
                    <button type="button" className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                      <Smile size={16} />
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
                  >
                    <Send size={14} /> Send
                  </button>
                </form>

                <div className="text-center">
                  <span className="text-[9.5px] font-mono text-slate-400 flex items-center justify-center gap-1">
                    <Shield size={11} className="text-purple-600" /> Messages are end-to-end encrypted via XMTP
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-center p-8 text-slate-400 space-y-3">
              <MessageSquare size={48} className="text-purple-600 stroke-1" />
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Select an Escrow Channel</h4>
                <p className="text-xs text-slate-500 mt-1 font-mono">Choose an active channel from the left sidebar to communicate.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Escrow Details Side Panel (3 Cols) */}
        <div className="lg:col-span-3 border-l border-slate-200 flex flex-col h-full bg-white p-5 overflow-y-auto space-y-5">
          {activeJob ? (
            <>
              <div>
                <span className="inline-flex items-center gap-1 text-[9.5px] font-mono font-bold uppercase tracking-wider text-purple-900 bg-purple-100/80 border border-purple-200 px-3 py-1 rounded-full">
                  {activeJob.status === 'Completed' ? 'COMPLETED ESCROW' : `${activeJob.status.toUpperCase()} ESCROW`}
                </span>
                <h3 className="font-headline font-extrabold text-slate-900 text-base mt-3 leading-snug">
                  {activeJob.title}
                </h3>
                <p className="text-xs text-slate-500 font-sans mt-1 leading-relaxed">
                  {activeJob.description}
                </p>
              </div>

              <div className="bg-slate-50/80 border border-slate-200/80 p-4 rounded-2xl space-y-1">
                <span className="text-[9.5px] uppercase font-mono text-slate-500 font-bold block tracking-wider">
                  LOCKED VAULT DEPOSIT
                </span>
                <div className="font-mono font-black text-slate-900 text-xl flex items-center justify-between">
                  <span>${parseFloat(activeJob.amountUsdc || '0').toFixed(2)} <span className="text-xs text-slate-500 font-normal">USDC</span></span>
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shadow-xs">
                    $
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-1 border-t border-slate-100">
                <span className="text-[9.5px] uppercase font-mono text-slate-400 font-bold block tracking-wider">
                  SMART CONTRACT ACTIONS
                </span>

                <div className="bg-purple-50/60 border border-purple-100 p-3.5 rounded-2xl flex items-center justify-between text-xs cursor-pointer hover:bg-purple-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-purple-200/70 text-purple-800 flex items-center justify-center">
                      <Shield size={14} />
                    </div>
                    <div>
                      <p className="font-bold text-purple-950 text-xs">Polygon Smart Escrow</p>
                      <p className="text-[10px] text-slate-500 font-mono">Non-custodial EIP-5192 vault protection.</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-400" />
                </div>

                <a 
                  href={`https://amoy.polygonscan.com/address/${activeJob.contractAddress || '0x'}`} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="bg-emerald-50/60 border border-emerald-100 p-3.5 rounded-2xl flex items-center justify-between text-xs hover:bg-emerald-50 transition-colors block"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-emerald-200/70 text-emerald-800 flex items-center justify-center">
                      <ArrowUpRight size={14} />
                    </div>
                    <div>
                      <p className="font-bold text-emerald-950 text-xs">View on Explorer</p>
                      <p className="text-[10px] text-slate-500 font-mono">Check transaction & escrow details</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-400" />
                </a>

                <Link 
                  to={`/audit/${activeJob.client}`} 
                  className="bg-amber-50/60 border border-amber-100 p-3.5 rounded-2xl flex items-center justify-between text-xs hover:bg-amber-50 transition-colors block"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-amber-200/70 text-amber-800 flex items-center justify-center">
                      <Download size={14} />
                    </div>
                    <div>
                      <p className="font-bold text-amber-950 text-xs">Download Receipt</p>
                      <p className="text-[10px] text-slate-500 font-mono">Export escrow information</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-400" />
                </Link>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                {activeJob.status === 'Open' && (
                  <button
                    onClick={handleProposeTerms}
                    className="w-full gradient-btn-primary py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <FileCheck size={14} /> Sign Terms Hash
                  </button>
                )}

                {((activeJob.status as string) === 'TermsAgreed' || activeJob.status === 'Selected') && (activeJob.client.toLowerCase() === (address || '').toLowerCase() || isTreasuryAdmin) && (
                  <button
                    onClick={handleFund}
                    className="w-full gradient-btn-emerald py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <DollarSign size={14} /> Fund Vault Deposit
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs font-medium">
              Select an escrow job to view smart contract actions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat;
