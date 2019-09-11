import React, { useState, useEffect, useContext } from 'react';
import { addSeconds, formatDistanceToNow } from 'date-fns';
import snxJSConnector from '../../../helpers/snxJSConnector';

import { Store } from '../../../store';
import { SliderContext } from '../../../components/Slider';
import { updateCurrentTab } from '../../../ducks/ui';

import Action from './Action';
import Confirmation from './Confirmation';
import Complete from './Complete';
import { bytesFormatter } from '../../../helpers/formatters';

import { createTransaction } from '../../../ducks/transactions';

const bigNumberFormatter = value =>
  Number(snxJSConnector.utils.formatEther(value));

const getFeePeriodCountdown = (
  periodIndex,
  recentFeePeriods,
  feePeriodDuration
) => {
  if (!recentFeePeriods) return;
  const currentFeePeriod = recentFeePeriods[periodIndex];
  const currentPeriodStart =
    currentFeePeriod && currentFeePeriod.startTime
      ? new Date(parseInt(currentFeePeriod.startTime * 1000))
      : null;
  const currentPeriodEnd =
    currentPeriodStart && feePeriodDuration
      ? addSeconds(currentPeriodStart, feePeriodDuration * 2 - periodIndex)
      : null;
  return `${formatDistanceToNow(currentPeriodEnd)} left`;
};

const useGetFeeData = walletAddress => {
  const [data, setData] = useState({});
  useEffect(() => {
    const getFeeData = async () => {
      const xdrBytes = bytesFormatter('XDR');
      const sUSDBytes = bytesFormatter('sUSD');
      try {
        setData({ ...data, dataIsLoading: true });
        const [
          feesByPeriod,
          feePeriodDuration,
          recentFeePeriods,
          feesAreClaimable,
          feesAvailable,
          xdrRate,
        ] = await Promise.all([
          snxJSConnector.snxJS.FeePool.feesByPeriod(walletAddress),
          snxJSConnector.snxJS.FeePool.feePeriodDuration(),
          Promise.all(
            Array.from(Array(2).keys()).map(period =>
              snxJSConnector.snxJS.FeePool.recentFeePeriods(period)
            )
          ),
          snxJSConnector.snxJS.FeePool.feesClaimable(walletAddress),
          snxJSConnector.snxJS.FeePool.feesAvailable(walletAddress, sUSDBytes),
          snxJSConnector.snxJS.ExchangeRates.rateForCurrency(xdrBytes),
        ]);
        const formattedXdrRate = bigNumberFormatter(xdrRate);
        const formattedFeesByPeriod = feesByPeriod
          .slice(1)
          .map(([fee, reward], i) => {
            return {
              fee: bigNumberFormatter(fee) * formattedXdrRate,
              reward: bigNumberFormatter(reward),
              closeIn: getFeePeriodCountdown(
                i,
                recentFeePeriods,
                feePeriodDuration
              ),
            };
          });
        setData({
          feesByPeriod: formattedFeesByPeriod,
          feesAreClaimable,
          feesAvailable: feesAvailable.map(bigNumberFormatter),
          dataIsLoading: false,
        });
      } catch (e) {
        console.log(e);
      }
    };
    getFeeData();
  }, [walletAddress]);
  return data;
};

const Claim = ({ onDestroy }) => {
  const { handleNext, handlePrev } = useContext(SliderContext);
  const sUSDBytes = bytesFormatter('sUSD');
  const [transactionInfo, setTransactionInfo] = useState({});
  const {
    state: {
      wallet: { currentWallet, walletType },
    },
    dispatch,
  } = useContext(Store);
  const {
    feesByPeriod,
    feesAreClaimable,
    feesAvailable,
    dataIsLoading,
  } = useGetFeeData(currentWallet);

  const onClaim = async () => {
    try {
      handleNext(1);
      const transaction = await snxJSConnector.snxJS.FeePool.claimFees(
        sUSDBytes
      );
      if (transaction) {
        setTransactionInfo({ transactionHash: transaction.hash });
        createTransaction(
          {
            hash: transaction.hash,
            status: 'pending',
            info: 'Claiming rewards',
            hasNotification: true,
          },
          dispatch
        );
        handleNext(2);
      }
    } catch (e) {
      setTransactionInfo({ ...transactionInfo, transactionError: e });
      handleNext(2);
      console.log(e);
    }
  };

  const onClaimHistory = () => {
    updateCurrentTab('escrow', dispatch);
  };

  const props = {
    onDestroy,
    onClaim,
    onClaimHistory,
    goBack: handlePrev,
    feesByPeriod,
    feesAreClaimable,
    feesAvailable,
    walletType,
    dataIsLoading,
    ...transactionInfo,
  };
  return [Action, Confirmation, Complete].map((SlideContent, i) => (
    <SlideContent key={i} {...props} />
  ));
};

export default Claim;
