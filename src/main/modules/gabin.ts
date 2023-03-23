import { Subject, BehaviorSubject } from 'rxjs'
import { skip } from 'rxjs/operators'
import type { Subscription } from 'rxjs'

import { ObsClient } from '../clients/OBSClient'
import { AutocamClient } from '../clients/AutocamClient'
import { StreamdeckClient } from '../clients/StreamdeckClient'
import { TcpServer } from '../servers/TcpServer'
import { OscServer } from '../servers/OscServer'

import db from '../utils/db'

import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'

import type {
    Shoot,
    AvailableMicsMap,
    Asset,
    MicId,
    AudioDeviceSettings,
} from '../../types/protocol'

interface Connections {
    obs: boolean
    streamdeck: boolean
}

export class Gabin {
    isOn: boolean
    isReady: boolean

    obs: ObsClient | undefined
    streamdeck: StreamdeckClient | undefined
    autocam: AutocamClient | undefined
    tcpServer: TcpServer | undefined
    oscServer: OscServer | undefined

    connections$: BehaviorSubject<Connections>

    shoot$: Subject<Shoot>
    autocam$: Subject<boolean>
    availableMics$: BehaviorSubject<AvailableMicsMap>
    triggeredShot$: BehaviorSubject<Asset['source']>
    timeline$: BehaviorSubject<MicId>
    volumeMics$: BehaviorSubject<Map<string, number>>

    private logger: Logger
    private subscriptions: Subscription[] = []

    constructor() {
        this.logger = getLogger('Gabin 🤖')

        this.isOn = false
        this.isReady = false

        this.shoot$ = new Subject<Shoot>()
        this.autocam$ = new Subject<boolean>()
        this.triggeredShot$ = new BehaviorSubject({ id: -1, name: '' })
        this.availableMics$ = new BehaviorSubject<AvailableMicsMap>(new Map())
        this.timeline$ = new BehaviorSubject('')
        this.volumeMics$ = new BehaviorSubject<Map<string, number>>(new Map())
        
        this.connections$ = new BehaviorSubject<Connections>({
            obs: false,
            streamdeck: false
        })

        this.logger.info('is currently asleep 💤')
    }

    private connect() {
        this.obs = new ObsClient()
        this.autocam = new AutocamClient()
        this.streamdeck = new StreamdeckClient()
        this.tcpServer = new TcpServer([this.streamdeck])
        this.oscServer = new OscServer()

        this.obs.reachable$.subscribe(r => {
            const c = this.connections$.getValue()
            c.obs = r
            this.connections$.next(c)
        })

        this.streamdeck.reachable$.subscribe(r => {
            const c = this.connections$.getValue()
            c.streamdeck = r
            this.connections$.next(c)
        })

        this.isReady = true
    }

    async power(on: boolean) {
        if (!this.isOn && on){
            await this.on()
        } else if (this.isOn && !on){
            this.off()
        }
        return on
    }

    private async on() {
        this.logger.info('is waking up 👋')

        if (!this.isReady) {
            this.connect()
        }

        this.initAvailableMics()

        this.obs?.connect()
        this.autocam?.connect()
        this.streamdeck?.connect()
        this.tcpServer?.listen()
        this.oscServer?.listen()

        this.streamdeck?.setAvailableMics(this.availableMics$.getValue())
        this.manageEvents()
        this.isOn = true
    }

    private off() {
        this.logger.info('is going to sleep 💤')
        this.cleanSubscriptions()

        this.obs?.clean()
        this.autocam?.clean()
        this.streamdeck?.clean()
        this.tcpServer?.clean()
        this.oscServer?.clean()

        this.isOn = false
    }

    private cleanSubscriptions() {
        for (const s of this.subscriptions) {
            s.unsubscribe()
        }
    }

    private initAvailableMics() {
        const audioDevices = db.getSpecificAndDefault(['settings', 'mics'], true)
        const devices: AudioDeviceSettings[] = audioDevices.defaultValue
        const mics = devices.reduce((p, d) => p.concat(d.micsName.filter((_m,i) => d.mics[i])), <string[]>[])
        const micsMap: AvailableMicsMap = new Map(mics.map((v)=>([v, true])))

        this.availableMics$.next(micsMap)
    }

    private selfEvents() {
        if (!this.autocam || !this.obs || !this.streamdeck) {
            return
        }

        // AUTOCAM EVT
        this.subscriptions.push(this.autocam.shoot$.subscribe(shot => {
            this.shoot$.next(shot)
        }))
        this.autocam.timeline$.subscribe(micId => {
            this.timeline$.next(micId)
        })
        this.autocam.volumeMics$.subscribe(vm => {
            this.volumeMics$.next(vm)
        })
        // STREAMDECK EVT
        this.subscriptions.push(this.streamdeck.autocam$.pipe(skip(1)).subscribe((autoCam) => {
            this.autocam$.next(autoCam)
        }))
        this.subscriptions.push(this.streamdeck.triggeredShot$.pipe(skip(1)).subscribe((shot) => {
            if (shot) {
                this.triggeredShot$.next(shot)
            }
        }))
    }

    private manageEvents() {
        if (!this.autocam || !this.obs || !this.streamdeck) {
            return
        }

        this.selfEvents()

        // OBS EVT
        this.subscriptions.push(this.obs.mainScene$.pipe(skip(1)).subscribe(scene => {
            this.logger.debug(scene)
            if (scene) {
                this.logger.info('has received a new scene from obs 🎬')
                if (this.autocam?.isReachable) this.autocam.setCurrentScene(scene.name)
            }
        }))
        // STREAMDECK EVT
        this.subscriptions.push(this.streamdeck.toggleMicAvailability$.subscribe((micId) => {
            this.toggleAvailableMic(micId)
        }))

        this.subscriptions.push(this.shoot$.subscribe(shoot => {
            this.logger.info('has made magic shot change ✨', `${shoot.container.name} | ${shoot.shot.name} | ${shoot.mode} mode`)

            if (this.obs?.isReachable) this.obs.shoot(shoot.container, shoot.shot)
            if (this.streamdeck?.isReachable) this.streamdeck.setCurrentShot(shoot.shot)
        }))
        this.subscriptions.push(this.autocam$.subscribe((autocam) => {
            this.logger.info('has to toggle autocam 🎚')
            this.autocam?.setEnabled(autocam)
            this.streamdeck?.setAutocam(autocam)
        }))
        this.subscriptions.push(this.availableMics$.subscribe((availableMics) => {
            this.logger.info('has new availability map 🗺', availableMics)
            this.autocam?.setAvailableMics(availableMics)
            this.streamdeck?.setAvailableMics(availableMics)
        }))
        this.subscriptions.push(this.triggeredShot$.subscribe((source) => {
            if (source.id < 0) return
            this.logger.info('has been ordered to shot 😣')
            this.autocam?.forcedShot$.next(source)
        }))
    }

    toggleAvailableMic(micId: MicId) {
        const micsMap = this.availableMics$.getValue()

        const mic = micsMap.get(micId)
        micsMap.set(micId, !mic)

        this.availableMics$.next(micsMap)
    }

}