import { startClient } from '@neoworks/svelte-gtk4/client'
import Counter from './Counter.svelte'

startClient({ counter: Counter })
