import { ref, computed } from 'vue';
import { defineStore, acceptHMRUpdate, useNuxtApp } from '#imports';
import type { TypeId } from '@u22n/utils';

export const useConvoStore = defineStore(
  'convos',
  () => {
    const { $trpc } = useNuxtApp();

    const convosListCursor = ref<{
      cursorLastUpdatedAt: Date | null;
      cursorLastPublicId: string | null;
    }>({
      cursorLastUpdatedAt: null,
      cursorLastPublicId: null
    });
    const orgMemberHasMoreConvos = ref(true);
    const pauseConvoLoading = ref(false);

    type OrgMemberConvosDataType = Awaited<
      ReturnType<typeof $trpc.convos.getOrgMemberConvos.query>
    >['data'];
    const orgMemberConvos = ref<OrgMemberConvosDataType>([]);

    type UserConvoQueryParams =
      | {
          cursorLastUpdatedAt: Date;
          cursorLastPublicId: string;
        }
      | {};
    const convoQueryParams = ref<UserConvoQueryParams>({});
    const convoQueryPending = ref(true);
    const orgMemberHasConvos = computed(() => {
      return orgMemberConvos.value.length > 0;
    });

    async function getConvoList() {
      convoQueryPending.value = true;
      const { data: convosListData } =
        await $trpc.convos.getOrgMemberConvos.useQuery(convoQueryParams);

      if (!convosListData.value) {
        convoQueryPending.value = false;
        return;
      }
      if (
        !convosListData.value.data ||
        !convosListData.value.cursor ||
        convosListData.value.data.length === 0
      ) {
        orgMemberHasMoreConvos.value = false;
        convoQueryPending.value = false;
        return;
      }

      orgMemberConvos.value.push(...convosListData.value.data);
      convosListCursor.value.cursorLastUpdatedAt =
        convosListData.value.cursor.lastUpdatedAt;
      convosListCursor.value.cursorLastPublicId =
        convosListData.value.cursor.lastPublicId;

      convoQueryPending.value = false;
    }

    async function fetchAndAddSingleConvo({
      convoPublicId
    }: {
      convoPublicId: TypeId<'convos'>;
    }) {
      const { data: newConvo } =
        await $trpc.convos.getOrgMemberSpecificConvo.useQuery({
          convoPublicId
        });
      if (!newConvo.value || !('publicId' in newConvo.value)) return;
      //! send push notification
      orgMemberConvos.value.unshift(newConvo.value);
    }

    async function fetchAndReplaceSingleConvo({
      convoPublicId
    }: {
      convoPublicId: TypeId<'convos'>;
    }) {
      const { data: newConvo } =
        await $trpc.convos.getOrgMemberSpecificConvo.useQuery({
          convoPublicId
        });
      if (!newConvo.value || !('publicId' in newConvo.value)) return;

      // replace the existing convo data with the new one
      const convoIndex = orgMemberConvos.value.findIndex(
        (convo) => convo.publicId === convoPublicId
      );
      if (convoIndex === -1) return;
      // replace the data of the existing convo
      orgMemberConvos.value.splice(convoIndex, 1, newConvo.value);
    }

    async function refreshConvoInList({
      convoPublicId
    }: {
      convoPublicId: TypeId<'convos'>;
    }) {
      const convoIndex = orgMemberConvos.value.findIndex(
        (convo) => convo.publicId === convoPublicId
      );

      if (convoIndex === -1) {
        await fetchAndAddSingleConvo({ convoPublicId });
        return;
      }
      await fetchAndReplaceSingleConvo({ convoPublicId });
    }

    return {
      getConvoList,
      fetchAndAddSingleConvo,
      refreshConvoInList,
      orgMemberConvos,
      orgMemberHasConvos,
      orgMemberHasMoreConvos,
      convosListCursor,
      pauseConvoLoading,
      convoQueryParams,
      convoQueryPending
    };
  },
  {
    share: { enable: false },
    persist: false
  }
);

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useConvoStore, import.meta.hot));
}
