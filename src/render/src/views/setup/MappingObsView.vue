<script lang="ts" setup>

import { ref, watch, toRaw } from 'vue'

import { store } from '@src/store/store'

import ButtonUi from '@src/components/basics/ButtonUi.vue'
import SelectUi from '@src/components/basics/SelectUi.vue'
import ModalUi from '@src/components/basics/ModalUi.vue'

import InfoIcon from '@src/components/icons/InfoIcon.vue'
import PlusIcon from '@src/components/icons/PlusIcon.vue'
import BinIcon from '@src/components/icons/BinIcon.vue'

import Tuto from '@src/components/setup/ObsTuto.vue'
import SourcesTree from '@src/components/setup/SourcesTree.vue'

import { onEnterPress } from '@src/components/utils/KeyPress.vue'
import { socketEmitter } from '@src/components/utils/UtilsTools.vue'

import type { Asset } from '../../../../types/protocol'

const scenes_ = ref<Asset['scene'][]>(store.profiles.settings().containers)
const filtered_ = ref<Asset['scene'][]>([])
const containers_ = ref<Asset['container'][]>([])
const tuto_ = ref<boolean>(store.profiles.editProfile? false : true)

const connectObs = () => {
    if (store.connections.obs || !store.profiles.editProfile) return

    const connections = store.profiles.connections()
    if (!connections.obs) return

    socketEmitter(store.socket, 'connectObs', toRaw(connections.obs))
    store.toast.info('OBS connection attempt', 'Please wait...', 3000)

    setTimeout(() => {
        if (store.connections.obs) {
            store.toast.success('OBS connection succeeded', '', 2000)
        } else {
            store.toast.error('OBS connection failed', 'Please check your settings')
            socketEmitter(store.socket, 'disconnectObs')
        }
    }, 3000)
}

const addScene = () => {
    scenes_.value.push({
        name: '',
        containers: []
    })
    updateNextBtn()
}

const removeScene = (index: number) => {
    scenes_.value.splice(index, 1)
    updateNextBtn()
}

const addContainer = (index: number) => {
    scenes_.value[index].containers.push({
        name: '',
        sources: []
    })
    updateNextBtn()
}

const removeContainer = (scIndex: number, soIndex: number) => {
    scenes_.value[scIndex].containers.splice(soIndex, 1)
    updateNextBtn()
}

const updateScene = (asset: Asset['scene'], index: number) => {
    scenes_.value[index].name = asset.name
    scenes_.value[index].containers = []

    updateNextBtn()
}

const updateContainer = (container: Asset['container'], scIndex: number, soIndex: number) => {
    scenes_.value[scIndex].containers[soIndex] = container
    updateNextBtn()
}

const filterScenes = (scenes: Asset['scene'][]): Asset['scene'][] => {
    const filtered: Asset['scene'][] = []
    const scenesNames = scenes.map(s => s.name)

    for (const scene of scenes) {
        for (const container of scene.containers) {
            for (const source of container.sources) {
                if (scenesNames.indexOf(source.name) > -1 && filtered.indexOf(scene) === -1) {
                    filtered.push(scene)
                }
            }
        }
    }

    filtered.sort((a, b) => {
        if (a.name < b.name) return -1
        if (a.name > b.name) return 1
        return 0
    })

    return filtered
}

const removeChoosenScenes = (sceneName: Asset['scene']['name']): Asset['scene'][] => {
    const scenesNames = scenes_.value.filter(s => s.name !== sceneName).map(s => s.name)
    return filtered_.value.filter(s => scenesNames.indexOf(s.name) === -1)
}

const getContainersFromScene = (sceneName: Asset['scene']['name'], containerName: Asset['container']['name']): Asset['container'][] => {
    const containers: Asset['container'][] = []

    const scene = filtered_.value.find(s => s.name === sceneName)
    if (!scene) return containers

    const selectedScene = scenes_.value.find(s => s.name === sceneName)
    if (!selectedScene) return containers

    const containersNames = selectedScene.containers.filter(c => c.name !== containerName).map(c => c.name)

    for (const i in scene.containers) {
        for (const source of scene.containers[i].sources) {
            const container = containers_.value.find(c => c.name === source.name)
            if (container && containers.indexOf(container) === -1 && containersNames.indexOf(container.name) === -1) {
                containers.push(container)
            }
        }
    }

    containers.sort((a, b) => {
        if (a.name < b.name) return -1
        if (a.name > b.name) return 1
        return 0
    })

    return containers
}

const getContainersFromScenes = (scenes: Asset['scene'][]): Asset['container'][] => {
    const containersNames: Asset['source']['name'][] = []
    const scenesNames = scenes.map(s => s.name)

    for (const scene of scenes) {
        for (const container of scene.containers) {
            for (const source of container.sources) {
                if (scenesNames.indexOf(source.name) > -1 && containersNames.indexOf(source.name) === -1) {
                    containersNames.push(source.name)
                }
            }
        }
    }

    const containers: Asset['container'][] = []
    for (const scene of scenes) {
        if (containersNames.indexOf(scene.name) > -1) {
            containers.push({
                name: scene.name,
                sources: scene.containers[0].sources
            })
        }
    }

    return containers
}

const nextIsInvalid = (): boolean => {
    if (scenes_.value.length === 0) return true

    for (const c of scenes_.value) {
        if (!c.name) return true

        for (const s of c.containers) {
            if (!s.name) return true
        }
    }

    return false
}

const updateNextBtn = () => {
    store.layout.footer.next.disable = nextIsInvalid()
}

watch(() => store.assets.scenes, () => {
    containers_.value = getContainersFromScenes(store.assets.scenes)
    filtered_.value = filterScenes(store.assets.scenes)
    updateNextBtn()
})

onEnterPress(() => {
    if (!nextIsInvalid() && store.layout.footer.next.trigger) {
        store.layout.footer.next.trigger()
    }
})

store.layout.footer.back.callback = () => {
    if (store.profiles.editProfile) {
        socketEmitter(store.socket, 'disconnectObs')
    }
}

store.layout.footer.next.callback = async () => {
    if (store.profiles.editProfile) {
        await store.profiles.save()
        store.toast.success('Profile saved !')
    }
}

containers_.value = getContainersFromScenes(store.assets.scenes)
filtered_.value = filterScenes(store.assets.scenes)
connectObs()
updateNextBtn()

</script>

<template>
    <div class="flex flex-col w-full pb-10">
        <Teleport to="#header-btn-slot">
            <ButtonUi
                class="i-first mx-1 h-12 whitespace-nowrap"
                @click="() => tuto_ = true"
            >
                <InfoIcon />
                Open tutorial
            </ButtonUi>
        </Teleport>

        <ModalUi
            :open="tuto_"
            @close="tuto_ = false"
        >
            <div class="flex flex-col w-full">
                <Tuto />
                <div class="flex justify-end w-full">
                    <ButtonUi
                        class="primary"
                        @click="tuto_ = false"
                    >
                        I got it !
                    </ButtonUi>
                </div>
            </div>
        </ModalUi>

        <div class="flex items-center bg-bg-2 text-content-2 text-sm p-4">
            <span class="emoji">📺</span>
            <p>Tell Gabin which scenes you want him to manage.</p>
        </div>
        <ButtonUi
            class="add-scene-btn i-first primary w-full h-14 mt-4"
            @click="addScene"
        >
            <PlusIcon />
            Add a scene
        </ButtonUi>
        <div class="flex-1 overflow-y-auto">
        <div
            v-for="(scene, scIndex) in scenes_"
            :key="'scene-' + scIndex"
            class="bg-bg-2 flex flex-col w-full p-2 mt-4"
        >
            <div class="flex w-full justify-between items-center">
                <div class="w-2/3 flex justify-start items-center">
                    <SelectUi
                        class="bg-bg-1 flex-1 mr-2"
                        :options="removeChoosenScenes(scene.name)"
                        label="Scene"
                        :value="scenes_[scIndex].name"
                        keyvalue="name"
                        @update="(s: Asset['scene']) => updateScene(s, scIndex)"
                    />
                </div>
                <div class="flex justify-end items-center">
                    <ButtonUi
                        class="add-source-btn i-first primary"
                        @click="() => addContainer(scIndex)"
                    >
                        <PlusIcon />
                        Add a container
                    </ButtonUi>
                    <ButtonUi
                        class="i-round ml-2"
                        @click="() => removeScene(scIndex)"
                        title="Remove scene"
                    >
                        <BinIcon />
                    </ButtonUi>
                </div>
            </div>
            <div
                v-for="(container, soIndex) in scenes_[scIndex].containers"
                :key="`container-${scIndex}-${soIndex}`"
                class="flex w-full justify-between items-center mt-4"
            >
                <div class="w-2/3 flex justify-end items-center">
                    <div class="w-8" />
                    <SelectUi
                        class="bg-bg-1 flex-1 mr-2"
                        :options="getContainersFromScene(scenes_[scIndex].name, container.name)"
                        label="Container"
                        :value="scenes_[scIndex].containers[soIndex].name"
                        keyvalue="name"
                        @update="(c: Asset['container']) => updateContainer(c, scIndex, soIndex)"
                    />
                </div>
                <div class="flex justify-end items-center">
                    <div class="flex-1">
                        <SourcesTree
                            v-if="scenes_[scIndex].containers[soIndex].name"
                            :list="scenes_[scIndex].containers[soIndex].sources.map(s => s.name)"
                        />
                    </div>
                    <ButtonUi
                        class="i-round ml-2"
                        @click="() => removeContainer(scIndex, soIndex)"
                        title="Remove source"
                    >
                        <BinIcon />
                    </ButtonUi>
                </div>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
.add-scene-btn {
    justify-content: center !important;
}
</style>