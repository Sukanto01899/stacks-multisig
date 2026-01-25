import { useEffect, useMemo, useState } from 'react'
import {
  AppConfig,
  UserSession,
  showConnect,
  openContractCall,
} from '@stacks/connect'
import {
  AnchorMode,
  PostConditionMode,
  bufferCV,
  fetchCallReadOnlyFunction,
  contractPrincipalCV,
  cvToHex,
  listCV,
  noneCV,
  principalCV,
  someCV,
  uintCV,
} from '@stacks/transactions'
import { createNetwork, networkFromName } from '@stacks/network'
import './App.css'

type NetworkMode = 'mainnet' | 'testnet' | 'devnet'

const appConfig = new AppConfig(['store_write', 'publish_data'])
const userSession = new UserSession({ appConfig })

const appDetails = {
  name: 'Stacks Multisig',
  icon: 'https://stacks.co/favicon.ico',
}

const defaultContractName = 'multisig-v3'
const defaultTokenName = 'mock-token-v3'

const normalizeLines = (value: string) =>
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)

const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/i, '').trim()
  if (!/^[\da-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    return null
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16)
  }
  return bytes
}

function App() {
  const [userData, setUserData] = useState<null | ReturnType<
    typeof userSession.loadUserData
  >>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [networkMode, setNetworkMode] = useState<NetworkMode>('mainnet')
  const [apiUrl, setApiUrl] = useState('http://localhost:3999')
  const [contractAddress, setContractAddress] = useState(
    'SP1G4ZDXED8XM2XJ4Q4GJ7F4PG4EJQ1KKXRCD0S3K'
  )
  const [contractName, setContractName] = useState(defaultContractName)
  const [tokenAddress, setTokenAddress] = useState(
    'SP1G4ZDXED8XM2XJ4Q4GJ7F4PG4EJQ1KKXRCD0S3K'
  )
  const [tokenName, setTokenName] = useState(defaultTokenName)

  const [initSigners, setInitSigners] = useState('')
  const [initThreshold, setInitThreshold] = useState('2')

  const [submitType, setSubmitType] = useState<'0' | '1'>('0')
  const [submitAmount, setSubmitAmount] = useState('')
  const [submitRecipient, setSubmitRecipient] = useState('')

  const [executeId, setExecuteId] = useState('')
  const [executeSignatures, setExecuteSignatures] = useState('')

  const [tokenExecuteId, setTokenExecuteId] = useState('')
  const [tokenExecuteSignatures, setTokenExecuteSignatures] = useState('')

  const [hashTxnId, setHashTxnId] = useState('')
  const [hashTxnResult, setHashTxnResult] = useState('')

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const resumeSession = async () => {
      try {
        if (userSession.isSignInPending()) {
          await userSession.handlePendingSignIn()
        }
        if (userSession.isUserSignedIn()) {
          setUserData(userSession.loadUserData())
        }
      } catch (caught) {
        console.warn('Failed to restore session', caught)
        setUserData(null)
      } finally {
        setSessionReady(true)
      }
    }
    resumeSession()
  }, [])

  const network = useMemo(() => {
    if (networkMode === 'devnet') {
      return createNetwork({ network: 'devnet', client: { baseUrl: apiUrl } })
    }
    return networkFromName(networkMode)
  }, [networkMode, apiUrl])

  const addressForNetwork = (mode: NetworkMode) => {
    if (!userData) return ''
    const addresses = userData.profile?.stxAddress || {}
    if (mode === 'mainnet') return addresses.mainnet || ''
    return addresses.testnet || ''
  }

  const connectWallet = () => {
    setError('')
    if (sessionReady) {
      try {
        if (userSession.isUserSignedIn()) {
          setUserData(userSession.loadUserData())
          return
        }
      } catch (caught) {
        console.warn('Session data invalid, clearing storage.', caught)
        try {
          userSession.signUserOut(window.location.origin)
        } catch {
          // ignore
        }
      }
    }
    showConnect({
      userSession,
      appDetails,
      onFinish: () => {
        setUserData(userSession.loadUserData())
      },
      onCancel: () => setStatus('Wallet connection canceled.'),
    })
  }

  const disconnectWallet = () => {
    userSession.signUserOut(window.location.origin)
    setUserData(null)
  }

  const ensureContractReady = () => {
    if (!contractAddress || !contractName) {
      setError('Contract address and name are required.')
      return false
    }
    if (!userData) {
      setError('Connect a wallet first.')
      return false
    }
    return true
  }

  const handleInitialize = async () => {
    if (!ensureContractReady()) return
    const signers = normalizeLines(initSigners)
    if (!signers.length) {
      setError('Add at least one signer principal.')
      return
    }
    if (!initThreshold) {
      setError('Threshold is required.')
      return
    }
    const signersCV = listCV(signers.map((signer) => principalCV(signer)))
    const args = [signersCV, uintCV(BigInt(initThreshold))]
    setError('')
    setStatus('Opening wallet for initialize...')
    openContractCall({
      contractAddress,
      contractName,
      functionName: 'initialize',
      functionArgs: args,
      network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      onFinish: (data) => {
        setStatus(`Initialize submitted: ${data.txId}`)
      },
      onCancel: () => setStatus('Initialize canceled.'),
    })
  }

  const handleSubmitTxn = () => {
    if (!ensureContractReady()) return
    if (!submitAmount || !submitRecipient) {
      setError('Amount and recipient are required.')
      return
    }
    const isTokenTransfer = submitType === '1'
    if (isTokenTransfer && (!tokenAddress || !tokenName)) {
      setError('Token address and name are required for SIP-010 transfers.')
      return
    }
    const typeCV = uintCV(BigInt(submitType))
    const amountCV = uintCV(BigInt(submitAmount))
    const recipientCV = principalCV(submitRecipient)
    const tokenCV = isTokenTransfer
      ? someCV(contractPrincipalCV(tokenAddress, tokenName))
      : noneCV()

    setError('')
    setStatus('Opening wallet for submit-txn...')
    openContractCall({
      contractAddress,
      contractName,
      functionName: 'submit-txn',
      functionArgs: [typeCV, amountCV, recipientCV, tokenCV],
      network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      onFinish: (data) => {
        setStatus(`Transaction submitted: ${data.txId}`)
      },
      onCancel: () => setStatus('Submit canceled.'),
    })
  }

  const parseSignatures = (value: string) => {
    const sigs = normalizeLines(value)
    if (!sigs.length) return []
    const buffers: Uint8Array[] = []
    for (const sig of sigs) {
      const bytes = hexToBytes(sig)
      if (!bytes) {
        setError('Signatures must be hex strings.')
        return null
      }
      if (bytes.length !== 65) {
        setError('Each signature must be 65 bytes.')
        return null
      }
      buffers.push(bytes)
    }
    return buffers
  }

  const handleExecuteStx = () => {
    if (!ensureContractReady()) return
    if (!executeId) {
      setError('Transaction id is required.')
      return
    }
    const signatures = parseSignatures(executeSignatures)
    if (!signatures) return
    const signaturesCV = listCV(signatures.map((sig) => bufferCV(sig)))
    setError('')
    setStatus('Opening wallet for STX execution...')
    openContractCall({
      contractAddress,
      contractName,
      functionName: 'execute-stx-transfer-txn',
      functionArgs: [uintCV(BigInt(executeId)), signaturesCV],
      network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      onFinish: (data) => {
        setStatus(`Execute STX submitted: ${data.txId}`)
      },
      onCancel: () => setStatus('Execute STX canceled.'),
    })
  }

  const handleExecuteToken = () => {
    if (!ensureContractReady()) return
    if (!tokenExecuteId) {
      setError('Transaction id is required.')
      return
    }
    if (!tokenAddress || !tokenName) {
      setError('Token address and name are required.')
      return
    }
    const signatures = parseSignatures(tokenExecuteSignatures)
    if (!signatures) return
    const signaturesCV = listCV(signatures.map((sig) => bufferCV(sig)))
    setError('')
    setStatus('Opening wallet for token execution...')
    openContractCall({
      contractAddress,
      contractName,
      functionName: 'execute-token-transfer-txn',
      functionArgs: [
        uintCV(BigInt(tokenExecuteId)),
        contractPrincipalCV(tokenAddress, tokenName),
        signaturesCV,
      ],
      network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      onFinish: (data) => {
        setStatus(`Execute token submitted: ${data.txId}`)
      },
      onCancel: () => setStatus('Execute token canceled.'),
    })
  }

  const handleHashTxn = async () => {
    if (!contractAddress || !contractName) {
      setError('Contract address and name are required.')
      return
    }
    if (!hashTxnId) {
      setError('Transaction id is required.')
      return
    }
    setError('')
    setStatus('Fetching transaction hash...')
    const senderAddress =
      addressForNetwork(networkMode) || contractAddress || 'ST000000000000000000002AMW42H'
    try {
      const result = await fetchCallReadOnlyFunction({
        contractAddress,
        contractName,
        functionName: 'hash-txn',
        functionArgs: [uintCV(BigInt(hashTxnId))],
        network,
        senderAddress,
      })
      setHashTxnResult(cvToHex(result))
      setStatus('Hash loaded.')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Failed to fetch hash.'
      )
    }
  }

  const userAddress = addressForNetwork(networkMode)

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Stacks Multisig Console</p>
          <h1>Control multisig executions with wallet-backed signing.</h1>
          <p className="lede">
            Connect a Stacks wallet, configure the deployed contract, and submit
            or execute transactions with signer signatures.
          </p>
        </div>
        <div className="wallet-card">
          <div className="wallet-status">
            <span className={userData ? 'dot online' : 'dot offline'} />
            <div>
              <p className="label">Wallet</p>
              <p className="value">
                {userData ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
          {userData ? (
            <>
              <div className="wallet-meta">
                <p className="label">Address ({networkMode})</p>
                <p className="mono">{userAddress || 'Unavailable'}</p>
              </div>
              <button className="btn secondary" onClick={disconnectWallet}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn" onClick={connectWallet} disabled={!sessionReady}>
              {sessionReady ? 'Connect Wallet' : 'Loading Wallet...'}
            </button>
          )}
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Contract Settings</h2>
          <p className="hint">
            Point the UI at your deployed multisig-v3 contract. Devnet uses the
            custom API URL.
          </p>
          <div className="field">
            <label>Network</label>
            <select
              value={networkMode}
              onChange={(event) =>
                setNetworkMode(event.target.value as NetworkMode)
              }
            >
              <option value="mainnet">Mainnet</option>
              <option value="testnet">Testnet</option>
              <option value="devnet">Devnet</option>
            </select>
          </div>
          {networkMode === 'devnet' && (
            <div className="field">
              <label>Devnet API URL</label>
              <input
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="http://localhost:3999"
              />
            </div>
          )}
          <div className="field">
            <label>Contract Address</label>
            <input
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="ST..."
            />
          </div>
          <div className="field">
            <label>Contract Name</label>
            <input
              value={contractName}
              onChange={(event) => setContractName(event.target.value)}
            />
          </div>
          <div className="field">
            <label>Token Address (for SIP-010)</label>
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              placeholder="ST..."
            />
          </div>
          <div className="field">
            <label>Token Name</label>
            <input
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
            />
          </div>
        </div>

        <div className="panel">
          <h2>Initialize</h2>
          <p className="hint">
            Only the contract owner can call initialize once. Provide signer
            principals and the threshold required for execution.
          </p>
          <div className="field">
            <label>Signer Principals</label>
            <textarea
              rows={4}
              value={initSigners}
              onChange={(event) => setInitSigners(event.target.value)}
              placeholder="ST...&#10;ST..."
            />
          </div>
          <div className="field">
            <label>Threshold</label>
            <input
              value={initThreshold}
              onChange={(event) => setInitThreshold(event.target.value)}
              type="number"
              min="1"
            />
          </div>
          <button className="btn" onClick={handleInitialize}>
            Initialize Contract
          </button>
        </div>

        <div className="panel">
          <h2>Submit Transaction</h2>
          <p className="hint">
            Submit a new transfer that will wait for signer signatures.
          </p>
          <div className="field">
            <label>Transfer Type</label>
            <select
              value={submitType}
              onChange={(event) =>
                setSubmitType(event.target.value as '0' | '1')
              }
            >
              <option value="0">STX transfer</option>
              <option value="1">SIP-010 transfer</option>
            </select>
          </div>
          <div className="field">
            <label>Amount (uint)</label>
            <input
              value={submitAmount}
              onChange={(event) => setSubmitAmount(event.target.value)}
              type="number"
              min="1"
            />
          </div>
          <div className="field">
            <label>Recipient Principal</label>
            <input
              value={submitRecipient}
              onChange={(event) => setSubmitRecipient(event.target.value)}
              placeholder="ST..."
            />
          </div>
          <button className="btn" onClick={handleSubmitTxn}>
            Submit Transaction
          </button>
        </div>

        <div className="panel">
          <h2>Execute STX Transfer</h2>
          <p className="hint">
            Collect signatures over the transaction hash and paste them below.
          </p>
          <div className="field">
            <label>Transaction ID</label>
            <input
              value={executeId}
              onChange={(event) => setExecuteId(event.target.value)}
              type="number"
              min="0"
            />
          </div>
          <div className="field">
            <label>Signatures (hex, 65 bytes each)</label>
            <textarea
              rows={4}
              value={executeSignatures}
              onChange={(event) => setExecuteSignatures(event.target.value)}
              placeholder="0x..."
            />
          </div>
          <button className="btn" onClick={handleExecuteStx}>
            Execute STX Transfer
          </button>
        </div>

        <div className="panel">
          <h2>Execute SIP-010 Transfer</h2>
          <p className="hint">
            Provide the same token contract used on submit and signer
            signatures.
          </p>
          <div className="field">
            <label>Transaction ID</label>
            <input
              value={tokenExecuteId}
              onChange={(event) => setTokenExecuteId(event.target.value)}
              type="number"
              min="0"
            />
          </div>
          <div className="field">
            <label>Signatures (hex, 65 bytes each)</label>
            <textarea
              rows={4}
              value={tokenExecuteSignatures}
              onChange={(event) => setTokenExecuteSignatures(event.target.value)}
              placeholder="0x..."
            />
          </div>
          <button className="btn" onClick={handleExecuteToken}>
            Execute Token Transfer
          </button>
        </div>

        <div className="panel">
          <h2>Hash Transaction</h2>
          <p className="hint">
            Use this hash when signers sign the transaction off-chain.
          </p>
          <div className="field">
            <label>Transaction ID</label>
            <input
              value={hashTxnId}
              onChange={(event) => setHashTxnId(event.target.value)}
              type="number"
              min="0"
            />
          </div>
          <button className="btn secondary" onClick={handleHashTxn}>
            Fetch Hash
          </button>
          {hashTxnResult && (
            <div className="result mono">{hashTxnResult}</div>
          )}
        </div>
      </section>

      {(status || error) && (
        <section className="status">
          {error && <p className="error">{error}</p>}
          {status && <p className="info">{status}</p>}
        </section>
      )}
    </div>
  )
}

export default App
