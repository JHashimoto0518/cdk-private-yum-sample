import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_tg from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets'
import { Construct } from 'constructs';

export class CdkPrivateYumSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new ec2.Vpc(this, 'vpc', {
      vpcName: 'vpc',
      ipAddresses: ec2.IpAddresses.cidr('172.16.0.0/16'),
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        }
      ],
    });
    // add private endpoints for ssm
    vpc.addInterfaceEndpoint('ssm', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
    });
    vpc.addInterfaceEndpoint('ssmmessages', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    });
    vpc.addInterfaceEndpoint('ec2messages', {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    });
    // add private endpoint for yum repository on s3
    vpc.addGatewayEndpoint('s3', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      ]
    });

    //
    // security groups
    //
    const albSg = new ec2.SecurityGroup(this, 'alb-sg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for alb'
    })
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow http traffic from anyone')

    const webServerSg = new ec2.SecurityGroup(this, 'web-server-sg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for a web server'
    })
    webServerSg.connections.allowFrom(albSg, ec2.Port.tcp(80), 'allow http traffic from alb')

    //
    // web servers
    //
    const userData = ec2.UserData.forLinux({
      shebang: '#!/bin/bash',
    })
    userData.addCommands(
      // setup httpd
      'yum update -y',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      "sh -c 'echo \"This is a sample website.\" > /var/www/html/index.html'",
    )

    // launch one instance per AZ
    const targets: elbv2_tg.InstanceTarget[] = new Array();
    for (let [idx, az] of vpc.availabilityZones.entries()) {
      targets.push(
        new elbv2_tg.InstanceTarget(
          new ec2.Instance(this, `ec2-web-${idx++}`, {
            instanceName: `ec2-web-${idx++}`, // ec2-web-1, ec2-web-2, ...
            instanceType: new ec2.InstanceType('t2.medium'),
            machineImage: ec2.MachineImage.latestAmazonLinux({
              generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            }),
            vpc: vpc,
            vpcSubnets: vpc.selectSubnets({
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }),
            availabilityZone: az,
            securityGroup: webServerSg,
            blockDevices: [
              {
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(8, {
                  volumeType: ec2.EbsDeviceVolumeType.GP3,
                }),
              },
            ],
            userData,
            ssmSessionPermissions: true,
            propagateTagsToVolumeOnCreation: true,
          })
        )
      );
    }

    //
    // alb
    //
    const alb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
      internetFacing: true,
      vpc,
      vpcSubnets: {
        subnets: vpc.publicSubnets
      },
      securityGroup: albSg
    })

    const albListener = alb.addListener('alb-http-listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP
    })
    albListener.addTargets('target-web-server', {
      targets,
      port: 80
    })
  }
}
