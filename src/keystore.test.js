/* eslint-env mocha */
const assert = require('assert')
const {accountPermissions, checkKeySet} = require('./test-utils.js')
const {PrivateKey, Signature} = require('eosjs-ecc')
const ecc = require('eosjs-ecc')
const config = require('./config')

const Keystore = require('./keystore.js')

let pathname
let historyListener

config.history = {
  get location() {
    return { pathname, search: '', hash: '' }
  },
  get listen() {
    return callback => {
      historyListener = callback
    }
  }
}

let keystore

function reset() {
  if(keystore) {
    keystore.logout()
  }
  Keystore.wipeAll()
}

describe('Keystore', () => {
  const master = 'PW5JMx76CTUTXxpAbwAqGMMVzSeJaP5UVTT5c2uobcpaMUdLAphSp'

  beforeEach(() => {
    pathname = '/'
    reset()
  })

  afterEach(() => {
    reset()
  })

  it('create', () => {
    Keystore('uid')
  })

  it('initialize from disk', async function() {
    keystore = Keystore('myaccount')

    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()
    const pubkey = privateKey.toPublic().toString()

    keystore.addKey('active/mypermission', wif, true/*disk*/)

    keystore = Keystore('myaccount')
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['active/mypermission'],
      wif: ['active/mypermission']
    })
  })

  it('active key login (without comparing blockchain permission)', async function() {
    const keystore = Keystore('uid')
    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()

    keystore.deriveKeys({parent: wif})
    const keyPaths = ['active']

    assert.deepEqual(keystore.getKeyPaths(),
      {pubkey: keyPaths, wif: keyPaths})
  })

  it('owner key login (without comparing blockchain permission)', () => {
    const keystore = Keystore('uid')

    keystore.deriveKeys({parent: master})
    const keyPaths = ['active']

    assert.deepEqual(keystore.getKeyPaths(),
      {pubkey: keyPaths, wif: keyPaths})
  })

  for(const role of ['active', 'owner']) {
    it(`block ${role} key re-use`, () => {
      const keystore = Keystore('uid')
      const perm = JSON.parse(JSON.stringify(accountPermissions))

      const rolePos = role === 'active' ? 0 : role === 'owner' ? 2 : -1 
      const wif = perm[rolePos].required_auth.keys[0].key

      perm[(rolePos + 1) % perm.length].required_auth.keys[0].key = wif
      
      assert.throws(() => {
        keystore.deriveKeys({parent: master, accountPermissions: perm})
      }, / key reused in authority/)
      // }, new RegExp(`${role} key reused in authority`))
    })
  }

  it('derive all active permisison keys', () => {
    const keystore = Keystore('uid')
    keystore.deriveKeys({parent: master, accountPermissions})

    const keyPaths = ['active', 'active/mypermission']
    assert.deepEqual(keystore.getKeyPaths(), {pubkey: keyPaths, wif: keyPaths})
  })

  it('get derived active public keys', () => {
    const keystore = Keystore('uid')
    keystore.deriveKeys({parent: master, accountPermissions})

    assert.deepEqual(keystore.getPublicKeys(), [
      'EOS7vgT3ZsuUxWH1tWyqw6cyKqKhPjUFbonZjyrrXqDauty61SrYe',
      'EOS5MiUJEXxjJw6wUcE6yUjxpATaWetubAGUJ1nYLRSHYPpGCJ8ZU'
    ])
  })

  it('low permission page master login', () => {
    const uriRules = {
      'active/mypermission': '/'
    }

    keystore = Keystore('uid', {uriRules})
    keystore.deriveKeys({parent: master, accountPermissions})

    // Make sure "active" is not avabile, only active/mypermisison
    const keyPaths = ['active/mypermission']
    assert.deepEqual(
      keystore.getKeyPaths(),
      {pubkey: keyPaths, wif: keyPaths}
    )
  })

  it('low permission page login', () => {
    const uriRules = {
      'active/mypermission': '/'
    }

    const mypermission =
      PrivateKey(master.substring(2))
      .getChildKey('owner')
      .getChildKey('active')
      .getChildKey('mypermission')

    keystore = Keystore('uid', {uriRules})

    // Active key is not required, just the lower mypermission key
    keystore.deriveKeys({parent: mypermission, accountPermissions})

    const keyPaths = ['active/mypermission']
    assert.deepEqual(
      keystore.getKeyPaths(),
      {pubkey: keyPaths, wif: keyPaths}
    )
  })

  it('uri rules history', () => {
    const uriRules = {
      'owner': '/account_recovery',
      'active': '/transfers'
    }

    keystore = Keystore('uid', {uriRules})

    pathname = '/'
    assert.throws(() =>
      keystore.deriveKeys({parent: master, accountPermissions}),
      /invalid login for page/
    )

    pathname = '/account_recovery'

    keystore.deriveKeys({parent: master, accountPermissions})

    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['active', 'owner', 'active/mypermission'],
      wif: ['active', 'owner', 'active/mypermission']
    })

    pathname = '/transfers'
    historyListener() // trigger history change event
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['active', 'owner', 'active/mypermission'],
      wif: ['active', 'active/mypermission']
    })
  })

  it('timeout', (done) => {
    const config = {
      uriRules: {'**': '.*'},
      timeoutInMin: .0001,
      timeoutKeyPaths: ['owner', 'owner/**']
    }

    keystore = Keystore('myaccount', config)
    keystore.deriveKeys({parent: master, accountPermissions})

    const before = ['active', 'owner', 'active/mypermission']
    assert.deepEqual(keystore.getKeyPaths(), {pubkey: before, wif: before})

    function timeout() {
      const after = ['active', 'active/mypermission']
      assert.deepEqual(keystore.getKeyPaths(), {pubkey: before, wif: after})
      done()
    }

    setTimeout(() => {timeout()}, .003 * min)
  })

  it('deriveKey disk security', () => {
    keystore = Keystore('myaccount')
    assert.throws(() => 
      keystore.deriveKeys({parent: master, saveKeyMatches: 'owner'}),
      /do not save owner key to disk/
    )
  })

  it('addKey disk security', async function() {
    keystore = Keystore('myaccount')

    const disk = true
    const privateKey = await PrivateKey.randomKey()
    const save = path => keystore.addKey(path, privateKey, disk)

    assert.throws(() => {save('owner')}, /not be stored on disk/)
    assert.throws(() => {save('owner/cold')}, /not be stored on disk/)

    assert.doesNotThrow(() => {save('active')})
    assert.doesNotThrow(() => {save('active/mypermission')})
  })

  it('save key', async function() {
    keystore = Keystore('myaccount')
    const save = key => keystore.addKey('active', key)

    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()
    const publicKey = privateKey.toPublic()
    const pubkey = publicKey.toString()

    assert.deepEqual(save(privateKey), {wif, pubkey, dirty: true})
    assert.deepEqual(save(wif), {wif, pubkey, dirty: false})
    assert.deepEqual(save(publicKey), {pubkey, dirty: false})
    assert.deepEqual(save(pubkey), {pubkey, dirty: false})
  })

  it('save and get keys', async function() {
    keystore = Keystore('myaccount', {
      uriRules: {'**': '.*'} // allow owner key
    })

    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()
    const pubkey = privateKey.toPublic().toString()

    assert.deepEqual(keystore.addKey('owner', wif), {
      wif,
      pubkey,
      dirty: true
    })
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['owner'],
      wif: ['owner']
    })
    assert.deepEqual(keystore.getPublicKeys(), [pubkey])
    assert.deepEqual(keystore.getPublicKeys('owner'), [pubkey])

    assert.deepEqual(keystore.getPublicKey('owner'), pubkey)
    assert.deepEqual(keystore.getPrivateKey('owner'), wif)

    const cold = privateKey.getChildKey('cold')
    assert.deepEqual(keystore.getPublicKey('owner/cold'), cold.toPublic().toString())
    assert.deepEqual(keystore.getPrivateKey('owner/cold'), cold.toWif())

    // keep the owner key above, add public key active/other
    assert.deepEqual(keystore.addKey('active/other', pubkey), {
      pubkey,
      dirty: true
    })
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['owner', 'active/other'],
      wif: ['owner']
    })

    // add the private key for active/mypermission
    assert.deepEqual(keystore.addKey('active/mypermission', wif), {
      dirty: true,
      pubkey,
      wif
    })

    // now we have everything: owner, active/mypermission
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['owner', 'active/other', 'active/mypermission'],
      wif: ['owner', 'active/mypermission']
    })
  })

  it('removeKeys', async function() {
    keystore = Keystore('myaccount')

    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()
    const pubkey = privateKey.toPublic().toString()

    assert.deepEqual(keystore.addKey('active', wif), {wif, pubkey, dirty: true})

    keystore.removeKeys('active', true/*keepPublicKeys*/)
    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: ['active'],
      wif: []
    })

    keystore.removeKeys(new Set(['active']), false/*keepPublicKeys*/)
    assert.deepEqual(keystore.getKeyPaths(), {pubkey: [], wif: []})
  })

  it('signSharedSecret', async function() {
    keystore = Keystore('myaccount', {uriRules: {'**': '.*'}})

    keystore.deriveKeys({
      parent: master,
      accountPermissions // .. all 3 keys
    })

    const oneTimePrivate = await PrivateKey.randomKey()
    const oneTimePublic = ecc.privateToPublic(oneTimePrivate)

    const ss = await keystore.signSharedSecret(oneTimePublic)

    const sharedSecret = oneTimePrivate.getSharedSecret(ss.oneTimePublic)

    const recoveredPubkeys = ss.signatures.map(sig =>
      ecc.recover(sig, sharedSecret)
    )

    assert.equal(recoveredPubkeys.length, 3, 'expecting 3 keys')
    assert.deepEqual(
      keystore.getPublicKeys().sort(),
      recoveredPubkeys.sort()
    )
  })

  it('keyProvider', () => {
    keystore = Keystore('myaccount')
    keystore.deriveKeys({parent: master})

    const pubkeys = keystore.keyProvider({publicKeyPathMatcher: 'active'})

    assert.equal(pubkeys.length, 1, 'pubkeys.length')

    const wifs = keystore.keyProvider({pubkeys})
    assert.equal(wifs.length, 1, 'pubkeys.length')
    assert.equal(ecc.privateToPublic(wifs[0]), pubkeys[0])

    keystore.removeKeys('active')
    assert.throws(() => {keystore.keyProvider({pubkeys})}, 
      /login with your 'active' key/)

    keystore.removeKeys('active', false /* keepPublicKeys */)
    assert.throws(() => {keystore.keyProvider({pubkeys})}, 
      /missing public key EOS.*/)
  })

  it('wipe all', async function() {
    keystore = Keystore('myaccount')
    keystore.addKey('active/mypermission', await PrivateKey.randomKey(), true/*disk*/)

    Keystore.wipeAll()

    keystore = Keystore('myaccount')
    assert.deepEqual(keystore.getKeyPaths(), {pubkey: [], wif: []})
  })

  it('logout', async function() {
    keystore = Keystore('myaccount')

    const privateKey = await PrivateKey.randomKey()
    const wif = privateKey.toWif()
    const pubkey = privateKey.toPublic().toString()

    keystore.addKey('active/mypermission', wif, true/*disk*/)

    keystore.logout()

    assert.deepEqual(keystore.getKeyPaths(), {
      pubkey: [],
      wif: []
    })

    const keyPathStore2 = Keystore('myaccount')
    assert.deepEqual(keyPathStore2.getKeyPaths(), {
      pubkey: [],
      wif: []
    })
  })
})

const sec = 1000, min = 60 * sec
